import { fetch } from 'cross-fetch';
import {
    Injectable,
    NotFoundException,
    Inject,
    Logger,
    forwardRef,
    UnauthorizedException,
    BadRequestException,
    ConflictException,
} from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { InfluxService } from '../influx/influx.service.js';
import { UserEntity } from './entities/user.entity.js';
import { ReadResponseDTO, ReadUserDTO } from './dto/read-user.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { cache as cacheManager } from '../cacheStore.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { OrganizationEntity, OrganizationStatus } from './entities/organization.entity.js';
import { OrganizationPermissions } from './organization.permissions.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { OrganizationResponseDto } from './dto/organization-response.dto.js';
import { EnvironmentEntity } from './entities/environment.entity.js';
import { ReadBusinessEnvionmentResponse, ReadEnvionmentResponse } from './dto/read-environment.dto.js';
import { Environment } from './dto/Environment.js';
import { EntitlementEntity, EntitlementTypes, UserEntitlements } from './entities/entitlement.entity.js';
import { OfferingService } from '../offering/offering.service.js';

@Injectable()
export class EnvironmentService {
    private static readonly logger = new Logger(EnvironmentService.name);
    constructor(@Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService) {}

    async getCurrentEnvironment(userSubject: string): Promise<ReadEnvionmentResponse> {
        const { readCurrentUserEnv } = this.InfluxService;
        const results = await readCurrentUserEnv(userSubject);
        EnvironmentService.logger.log(`Results: ${JSON.stringify(results)}`);
        if (results.length) {
            const [result] = results;
            const entity = EnvironmentEntity.dbModelToEntity(result);
            return { message: 'Found environment', ...entity };
        } else {
            const entity = new EnvironmentEntity({ subject: userSubject });
            return { message: 'Found environment', ...entity };
        }
    }
    async getEnvironmentsForUser(userSubject: string): Promise<UserEntity[]> {
        const { readAllEnvironmentsForUser } = this.InfluxService;
        const results = await readAllEnvironmentsForUser(userSubject);
        if (results.length) {
            const entities = results.map((result) => UserEntity.dbModelToEntity([result]));
            return entities;
        } else {
            throw new NotFoundException(`User: ${userSubject} was not found`);
        }
    }
    async getEnvironmentForBusinessID(businessID): Promise<ReadBusinessEnvionmentResponse> {
        const { readEnvironmentForBusiness } = this.InfluxService;
        const results = await readEnvironmentForBusiness(businessID);
        if (results.length) {
            const entity = UserEntity.dbModelToEntity(results);
            return { message: 'Found environment', ...entity };
        } else {
            throw new NotFoundException(`Business ID: ${businessID} was not found`);
        }
    }

    async setCurrentEnvironment(userSubject: string, environment: Environment): Promise<ReadEnvionmentResponse> {
        const { loadPoints } = this.InfluxService;
        const entity = new EnvironmentEntity({ subject: userSubject, environment });
        const points = EnvironmentEntity.transformer(entity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        // Invalidate cache for this subject so next findOne reflects new env immediately
        try {
            // @ts-ignore cacheManager del may be sync/async
            await (cacheManager as any).del(userSubject);
        } catch (e) {
            // ignore
        }
        EnvironmentService.logger.log(`Set environment for ${userSubject} to ${environment}`);
        return { message: 'Environment updated', ...entity };
    }
}

@Injectable()
export class UsersService {
    private static readonly logger = new Logger(UsersService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        readonly environmentService: EnvironmentService,
    ) {}
    async create(createUserDto: CreateUserDto): Promise<BasicResponseDTO> {
        const { subject, businessID, temp, accountExpiryDate, environment } = createUserDto;
        const { loadPoints } = this.InfluxService;
        // Take in subject and business ID
        const userEntity = new UserEntity({ subject, businessID, temp, accountExpiryDate, environment });
        // Commit to TSDB
        const pointsArray = UserEntity.transformer(userEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, pointsArray);
        // Return message
        return { message: 'sucessfully uploaded user config' };
    }

    async findOne(readUserDTO: ReadUserDTO): Promise<ReadResponseDTO> {
        const { subject } = readUserDTO;
        // Do not use long-lived cache for businessID resolution; always hit DB for correctness of env switching and retirement.
        // We still use cache for auth0ManagementToken elsewhere, but not for user entity.
        // However to satisfy requirement that moving between envs takes effect immediately and retiring is immediate, we bypass cache.
        // If cache exists, we ignore it and refresh.
        UsersService.logger.warn(`UserEntity for subject: ${subject} cache bypass for immediate consistency`);
        const results = await this.getCurrentUserConfigFromDb(subject);
        if (results.length === 0) {
            throw new UnauthorizedException();
        }
        const userEntity = UserEntity.dbModelToEntity(results);
        // Optionally update cache with fresh value but with no TTL or short TTL; we store but not rely for next read
        try {
            await (cacheManager as any).set(subject, JSON.stringify(userEntity), 60);
        } catch (e) {}
        if ((userEntity as UserEntity).businessID) {
            return { message: 'Found user', data: [userEntity as UserEntity] };
        } else {
            throw new NotFoundException(`Business ID was not found for subject: ${subject}`);
        }
    }
    async getCurrentUserConfigFromDb(subject): Promise<Array<any>> {
        const { environment } = await this.environmentService.getCurrentEnvironment(subject);
        const { readUserData } = this.InfluxService;
        const results = await readUserData(subject, environment);
        return results;
    }

    async findAll(): Promise<ReadResponseDTO> {
        const { readAllUserData } = this.InfluxService;
        const results = await readAllUserData();
        const entities = results.map((result) => UserEntity.dbModelToEntity([result]));
        return { message: 'Found users', data: entities };
    }

    async findAllUsersForBusinessID({ businessID }: { businessID: string }): Promise<ReadResponseDTO> {
        const { readAllUsersForBusiness } = this.InfluxService;
        const results = await readAllUsersForBusiness(businessID);
        const entities = results.map((result) => UserEntity.dbModelToEntity([result]));
        return { message: 'Found users', data: entities };
    }

    // ---- API Key management ----

    private async getAllowedClientIdsForBusiness(businessID: string): Promise<{ clientIds: Set<string>, entities: UserEntity[] }> {
        const { readAllUsersForBusiness } = this.InfluxService;
        const results = await readAllUsersForBusiness(businessID);
        const entities = results.map((result) => UserEntity.dbModelToEntity([result]));
        // Only machine credentials: subject ends with @clients
        const filtered = entities.filter((e) => e.subject && e.subject.endsWith('@clients'));
        const clientIds = new Set(filtered.map((e) => e.subject.split('@')[0]));
        return { clientIds, entities: filtered };
    }

    async listKeysForBusiness(businessID: string): Promise<any> {
        const { clientIds, entities } = await this.getAllowedClientIdsForBusiness(businessID);
        // Fetch management token
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        // For each allowed client, fetch details from Auth0 single endpoint
        const results: any[] = [];
        for (const clientId of clientIds) {
            try {
                const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${access_token}`,
                        'cache-control': 'no-cache',
                    },
                });
                if (res.ok) {
                    const data = await res.json();
                    // Ensure we don't leak secret on list; mock will not include it for GET single anyway (no secret field unless include)
                    // But ensure we strip client_secret if present
                    const { client_secret, ...rest } = data;
                    results.push(rest);
                } else if (res.status === 404) {
                    // Client no longer exists at provider but still in influx? Should not happen after retire cleanup, but skip
                    continue;
                } else {
                    // For other errors, still propagate? Skip
                    continue;
                }
            } catch (e) {
                continue;
            }
        }
        // Sort for deterministic output
        results.sort((a, b) => (a.client_id || '').localeCompare(b.client_id || ''));
        return { message: 'Found keys', data: results };
    }

    async rotateKey(businessID: string, clientId: string): Promise<any> {
        const { clientIds } = await this.getAllowedClientIdsForBusiness(businessID);
        if (!clientIds.has(clientId)) {
            throw new NotFoundException(`Client ${clientId} not found for this business/environment`);
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'cache-control': 'no-cache',
                'content-type': 'application/json',
            },
        });
        if (!res.ok) {
            const body = await res.text().catch(() => '');
            UsersService.logger.error(`Rotate failed for ${clientId}: ${res.status} ${body}`);
            if (res.status === 404) throw new NotFoundException(`Client ${clientId} not found`);
            throw new BadRequestException(`Failed to rotate secret for ${clientId}`);
        }
        const data = await res.json();
        return { message: 'Rotated secret', data };
    }

    async deleteKey(businessID: string, clientId: string): Promise<any> {
        const { clientIds, entities } = await this.getAllowedClientIdsForBusiness(businessID);
        if (!clientIds.has(clientId)) {
            throw new NotFoundException(`Client ${clientId} not found for this business/environment`);
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok && res.status !== 204) {
            const body = await res.text().catch(() => '');
            UsersService.logger.error(`Delete failed for ${clientId}: ${res.status} ${body}`);
            if (res.status === 404) throw new NotFoundException(`Client ${clientId} not found`);
            throw new BadRequestException(`Failed to delete client ${clientId}`);
        }
        // Soft delete the mapping in influx so that bearer tokens for this client are immediately refused
        const subject = `${clientId}@clients`;
        const entityToDelete = entities.find((e) => e.subject === subject);
        if (entityToDelete) {
            const deleteEntity = new UserEntity({
                subject,
                businessID: entityToDelete.businessID,
                environment: entityToDelete.environment,
                softDelete: 'deleted',
            });
            const points = UserEntity.transformer(deleteEntity, this.InfluxService);
            await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        } else {
            // Fallback: still write delete point with current businessID and env from getCurrent? but we have businessID param, environment derived from businessID? businessID suffix indicates env
            const env = businessID.endsWith('-sandbox') ? Environment.SANDBOX : Environment.PRODUCTION;
            const deleteEntity = new UserEntity({
                subject,
                businessID,
                environment: env as Environment,
                softDelete: 'deleted',
            });
            const points = UserEntity.transformer(deleteEntity, this.InfluxService);
            await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        }
        // Clear cache for this subject so next auth is refused immediately
        try {
            await (cacheManager as any).del(subject);
        } catch (e) {}
        return { message: 'Client deleted' };
    }
}
@Injectable()
export class OrganizationService {
    private static readonly logger = new Logger(OrganizationService.name);
    constructor(
        readonly usersService: UsersService,
        readonly environmentService: EnvironmentService,
    ) {}
    async create(createOrganizationDto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        // Cant validate org inside of DTO since request object is needed.
        await OrganizationEntity.validateOrganizationDoesntExist(createOrganizationDto?.businessID, access_token);
        // Create Organization Entity
        const entity = new OrganizationEntity(createOrganizationDto);

        // Create Auth0 Organization

        const res = await OrganizationEntity.createAuth0Organization(entity, access_token);
        OrganizationService.logger.debug(`Auth0 Organization Creation Response: ${JSON.stringify(res)}`);
        const { id } = res;
        entity.orgId = id;
        const userSubject = createOrganizationDto.subjects[0];
        // Add current user to org, and make them the owner
        await OrganizationEntity.assignUserToOrganization(entity, access_token, userSubject);
        await UserEntity.updateUserPermissions(
            new UserEntity({ subject: userSubject, businessID: entity.businessID }),
            access_token,
            OrganizationPermissions.UPDATE,
        );

        return OrganizationResponseDto.fromEntity(entity, 'Organization was created successfully');
    }

    async update(updateOrganizationDto: UpdateOrganizationDto): Promise<BasicResponseDTO> {
        // Get current Entity
        const { businessID } = updateOrganizationDto;
        const { environment } = await this.environmentService.getCurrentEnvironment(updateOrganizationDto.subject);
        if (environment !== Environment.PRODUCTION) {
            throw new BadRequestException(
                `Cannot update organization in ${environment} environment. Must use ${Environment.PRODUCTION} environment`,
            );
        }

        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const org = await OrganizationEntity.findOrganizationByBusinessID(businessID, access_token);
        const users = await this.environmentService.getEnvironmentsForUser(updateOrganizationDto.subject);
        const sandboxBusinessID = users.find((user) => user.environment === Environment.SANDBOX)?.businessID;

        if (org) {
            OrganizationService.logger.debug(updateOrganizationDto);
            // invite new users to org if applicable
            if (updateOrganizationDto.emails) {
                const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
                await Promise.all(
                    updateOrganizationDto.emails.map(async (email) => {
                        const res = await OrganizationEntity.addUserToOrganization(
                            org,
                            access_token,
                            email,
                            businessID,
                            this.usersService,
                        );
                        await this.usersService.create({
                            subject: res?.userId,
                            businessID: sandboxBusinessID,
                            environment: Environment.SANDBOX,
                        });
                        return res;
                    }),
                );
            }
            let updatedEmailList = org.emails;
            if (org?.emails?.length) {
                updatedEmailList = org.emails.concat(updateOrganizationDto.emails);
            }
            // Create Organization Entity
            const entity = new OrganizationEntity(
                { ...org, ...updateOrganizationDto },
                OrganizationStatus.LIVE,
                org.orgId,
                updatedEmailList,
            );

            return OrganizationResponseDto.fromEntity(entity, 'Organization was Updated successfully');
        } else {
            throw new NotFoundException(`Organization was not found`);
        }
    }

    async findOne(businessID: string): Promise<OrganizationResponseDto> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const org = await OrganizationEntity.findOrganizationByBusinessID(businessID, access_token);
        if (org) {
            return OrganizationResponseDto.fromEntity(org, 'Organization was found successfully');
        } else {
            throw new NotFoundException(`Organization was not found`);
        }
    }
}
