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
import { fetch } from 'cross-fetch';

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
        if (!Object.values(Environment).includes(environment)) {
            throw new BadRequestException(`Invalid environment: ${environment}`);
        }
        const point = this.InfluxService.getPoint(EnvironmentEntity._measurement);
        point.tag('subject', userSubject);
        point.stringField('environment', environment);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, [point]);
        // Clear cache for this subject so next request picks up new environment immediately
        try {
            await cacheManager.del(userSubject);
        } catch (e) {}
        try {
            await cacheManager.del(`${userSubject}:${Environment.PRODUCTION}`);
        } catch (e) {}
        try {
            await cacheManager.del(`${userSubject}:${Environment.SANDBOX}`);
        } catch (e) {}
        const entity = new EnvironmentEntity({ subject: userSubject, environment });
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
        // Clear any cached entry for this subject (all env variants)
        try {
            await cacheManager.del(subject);
            await cacheManager.del(`${subject}:${Environment.PRODUCTION}`);
            await cacheManager.del(`${subject}:${Environment.SANDBOX}`);
        } catch (e) {}
        // Return message
        return { message: 'sucessfully uploaded user config' };
    }

    async findOne(readUserDTO: ReadUserDTO): Promise<ReadResponseDTO> {
        // Given a subject, resolve current environment first to make cache env-aware
        const { subject } = readUserDTO;
        const { environment } = await this.environmentService.getCurrentEnvironment(subject);
        const cacheKey = `${subject}:${environment}`;
        let cached = await cacheManager.get(cacheKey);
        let userEntity: UserEntity;
        if (cached) {
            UsersService.logger.log(`UserEntity for subject: ${subject} in cache for env ${environment}`);
            try {
                userEntity = JSON.parse(cached as string);
            } catch (e) {
                userEntity = cached as unknown as UserEntity;
            }
        } else {
            // Fallback check old key for migration, but if found validate env matches
            const oldCached = await cacheManager.get(subject);
            if (oldCached) {
                try {
                    const parsed = JSON.parse(oldCached as string);
                    if (parsed.environment === environment) {
                        UsersService.logger.log(`UserEntity for subject: ${subject} in legacy cache`);
                        userEntity = parsed;
                        // Promote to new key
                        await cacheManager.set(cacheKey, JSON.stringify(userEntity), 604800);
                    }
                } catch (e) {}
            }
        }
        if (!userEntity) {
            UsersService.logger.warn(`UserEntity for subject: ${subject} not in cache for env ${environment}`);
            const results = await this.getCurrentUserConfigFromDb(subject);
            if (results.length === 0) {
                throw new UnauthorizedException();
            }
            userEntity = UserEntity.dbModelToEntity(results);
            await cacheManager.set(cacheKey, JSON.stringify(userEntity), 604800);
            // Also set legacy key for backward compat? Clear it to avoid stale
            try {
                await cacheManager.del(subject);
            } catch (e) {}
        }
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

    // ---- Keys management ----

    private async verifyKeyBelongsToBusiness(businessID: string, clientId: string): Promise<UserEntity | null> {
        const subject = `${clientId}@clients`;
        try {
            const { data } = await this.findAllUsersForBusinessID({ businessID });
            const found = data.find((u) => u.subject === subject);
            return found || null;
        } catch (e) {
            return null;
        }
    }

    async listKeys(businessID: string): Promise<{ message: string; data: any[] }> {
        const { data } = await this.findAllUsersForBusinessID({ businessID });
        const machineUsers = data.filter((u) => u.subject.endsWith('@clients'));
        const clientIdSet = new Set(machineUsers.map((u) => u.subject.split('@')[0]));
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        // Fetch all clients via management API
        const allClients: any[] = [];
        let page = 0;
        const perPage = 50;
        while (true) {
            const res = await fetch(`https://auth.meteringco.example/api/v2/clients?per_page=${perPage}&page=${page}&include_fields=false`, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${access_token}`,
                    'content-type': 'application/json',
                },
            });
            if (!res.ok) {
                const txt = await res.text();
                throw new Error(`Failed to list clients: ${res.status} ${txt}`);
            }
            const body = await res.json();
            const clients = Array.isArray(body) ? body : body.clients || [];
            // Filter to only those belonging to this business
            const filtered = clients.filter((c: any) => clientIdSet.has(c.client_id));
            allClients.push(...filtered);
            if (clients.length < perPage) break;
            // If we got a full page but filtered count may be less, still need to continue until no more pages
            // Check if total clients less than perPage, then done. Otherwise continue.
            // To avoid infinite loop, check if clients length < perPage
            if (clients.length < perPage) break;
            page++;
            if (page > 20) break;
            // Also if filtered is empty and we keep paging, but we need to fetch all pages to find matches.
            // So we continue even if filtered is empty.
        }
        // Alternative: fetch total count via include_totals to know when to stop, but loop handles
        // Ensure we return unique
        // If we filtered per page, we may have missed clients due to pagination where filtered clients are sparse.
        // Better to fetch all pages without filtering early, then filter at end.
        // So if we need to re-fetch without per-page filtering, we did.
        // Actually we filtered after fetch, but we still pushed filtered. That's correct as we collect all.
        // However we need to know when to stop: if clients.length < perPage we stop.
        // The above loop does that.
        // Edge: if DB has 2 clients but IdP has 13, we will fetch all pages.
        return { message: 'Found keys', data: allClients };
    }

    async rotateKey(businessID: string, clientId: string): Promise<any> {
        const belongs = await this.verifyKeyBelongsToBusiness(businessID, clientId);
        if (!belongs) {
            throw new NotFoundException(`Client ${clientId} not found`);
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'content-type': 'application/json',
            },
        });
        if (!res.ok) {
            const body = await res.text();
            if (res.status === 404) {
                throw new NotFoundException(`Client ${clientId} not found`);
            }
            throw new Error(`Failed to rotate secret: ${res.status} ${body}`);
        }
        const json = await res.json();
        // Clear cache for that machine subject just in case (though not needed for secret rotation)
        const subject = `${clientId}@clients`;
        try {
            await cacheManager.del(subject);
            await cacheManager.del(`${subject}:${Environment.PRODUCTION}`);
            await cacheManager.del(`${subject}:${Environment.SANDBOX}`);
        } catch (e) {}
        return json;
    }

    async deleteKey(businessID: string, clientId: string): Promise<any> {
        const belongs = await this.verifyKeyBelongsToBusiness(businessID, clientId);
        if (!belongs) {
            throw new NotFoundException(`Client ${clientId} not found`);
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'content-type': 'application/json',
            },
        });
        if (!res.ok && res.status !== 204) {
            if (res.status === 404) {
                throw new NotFoundException(`Client ${clientId} not found`);
            }
            const body = await res.text();
            throw new Error(`Failed to delete client: ${res.status} ${body}`);
        }
        // Mark as softDeleted in Influx
        const subject = `${clientId}@clients`;
        const env = belongs.environment;
        const deletedEntity = new UserEntity({
            subject,
            businessID,
            environment: env,
            softDelete: 'deleted',
        });
        const points = UserEntity.transformer(deletedEntity, this.InfluxService);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        // Clear cache for that subject immediately so next token use is refused
        try {
            await cacheManager.del(subject);
            await cacheManager.del(`${subject}:${Environment.PRODUCTION}`);
            await cacheManager.del(`${subject}:${Environment.SANDBOX}`);
        } catch (e) {}
        // Also clear any cache for the businessID listing? Not needed as we query fresh
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
