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
import { UpdateEnvironmentDto } from './dto/update-environment.dto.js';
import { ApiKeyEntity } from './entities/apiKey.entity.js';
import { DeleteKeyResponseDTO, ReadKeyDTO, ReadKeysResponseDTO, RotateKeyResponseDTO } from './dto/read-keys.dto.js';

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
    /**
     * Move a user into one of the environments their account holds.
     *
     * The switch is a new row rather than an edit, and the entry which maps the
     * subject onto an account is dropped, so the environment the caller is in
     * governs the whole of the very next request: the account it resolves to,
     * the keys listed back and the data reachable through them.
     */
    async update({ userSubject, environment }: UpdateEnvironmentDto): Promise<ReadEnvionmentResponse> {
        if (!userSubject) {
            throw new BadRequestException('A userSubject is required to update the environment');
        }
        const entity = new EnvironmentEntity({ subject: userSubject, environment });
        const points = EnvironmentEntity.transformer(entity, this.InfluxService);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        await cacheManager.del(userSubject);
        EnvironmentService.logger.log(`Subject: ${userSubject} is now in the ${entity.environment} environment`);
        return { message: 'Environment updated', subject: entity.subject, environment: entity.environment };
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
        // Given a subject
        const { subject } = readUserDTO;

        let userEntity = await cacheManager.get(subject);
        if (!userEntity) {
            UsersService.logger.warn(`UserEntity for subject: ${subject} not in cache`);
            // Read User's current ENV
            const results = await this.getCurrentUserConfigFromDb(subject);
            if (results.length === 0) {
                throw new UnauthorizedException();
            }
            userEntity = UserEntity.dbModelToEntity(results);
            await cacheManager.set(subject, JSON.stringify(userEntity), 604800);
        } else {
            UsersService.logger.log(`UserEntity for subject: ${subject} in cache`);
            userEntity = JSON.parse(userEntity as string);
        }
        // Query TSDB for latest row

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

/**
 * A request against the key screen: who is asking, which key they named, and
 * the environment the request belongs to.
 */
export type KeyRequest = {
    subject: string;
    keyId?: string;
    environment?: string;
};

/**
 * The console's API key screen.
 *
 * An API key is a machine credential held by the identity provider, owned by
 * exactly one environment of exactly one account. Every operation below is
 * scoped to the account the caller resolves to in the environment they are
 * currently in, so a key which belongs to another tenant, to the other
 * environment of this tenant, to an integration which has already been retired,
 * or to an application the tenant never claimed, is not theirs to see or change.
 */
@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        readonly environmentService: EnvironmentService,
    ) {}

    /**
     * The account the request resolves to, in the environment the caller is in.
     *
     * Read straight from the configuration store rather than from a cache: a
     * credential which has been retired, or an environment which has just been
     * switched, has to be honoured on the very next request.
     */
    private async getCurrentAccount(
        subject: string,
        requestedEnvironment?: string,
    ): Promise<{ businessID: string; environment: Environment }> {
        if (!subject) {
            throw new UnauthorizedException();
        }
        // A request may name the environment it belongs to, as the rest of the
        // platform allows it to; otherwise the environment the caller is
        // currently in governs. Either way the account still has to hold the
        // caller in that environment.
        const chosen = Object.values(Environment).find((candidate) => candidate === requestedEnvironment);
        const { environment } = chosen
            ? { environment: chosen }
            : await this.environmentService.getCurrentEnvironment(subject);
        const results = await this.InfluxService.readUserData(subject, environment);
        if (!results?.length) {
            KeysService.logger.warn(`No account found for subject: ${subject} in the ${environment} environment`);
            throw new UnauthorizedException();
        }
        const { businessID } = UserEntity.dbModelToEntity(results);
        if (!businessID) {
            throw new UnauthorizedException();
        }
        return { businessID, environment };
    }

    /**
     * Refuse anything the current account does not hold, before the identity
     * provider is touched, so a key which is not the caller's is left exactly as
     * it was.
     */
    private async validateKeyIsHeldByAccount({
        keyId,
        businessID,
        environment,
    }: {
        keyId: string;
        businessID: string;
        environment: Environment;
    }): Promise<string> {
        const keySubject = ApiKeyEntity.subjectForKeyId(keyId);
        const results = keyId ? await this.InfluxService.readUserData(keySubject, environment) : [];
        const held = results?.find((result) => result?.businessID === businessID);
        if (!held) {
            KeysService.logger.warn(
                `Key: ${keyId} is not held by businessID: ${businessID} in the ${environment} environment`,
            );
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        return keySubject;
    }

    /**
     * Every key the current account holds in the environment the caller is in.
     */
    async findAll({ subject, environment: requestedEnvironment }: KeyRequest): Promise<ReadKeysResponseDTO> {
        const { businessID, environment } = await this.getCurrentAccount(subject, requestedEnvironment);
        const rows = await this.InfluxService.readAllUsersForBusiness(businessID);
        const held = (rows || []).filter(
            (row) =>
                ApiKeyEntity.isMachineSubject(row?.subject) && (!row?.environment || row.environment === environment),
        );
        if (!held.length) {
            return new ReadKeysResponseDTO('Found keys', []);
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const clients = await ApiKeyEntity.listClients(access_token);
        const data = held
            .map((row) => {
                const keyId = ApiKeyEntity.keyIdForSubject(row.subject);
                const client = clients.get(keyId);
                if (!client) {
                    // Claimed by the account but no longer held by the identity
                    // provider, so there is no credential left to show.
                    KeysService.logger.warn(`Key: ${keyId} is not held by the identity provider`);
                    return undefined;
                }
                return new ReadKeyDTO({
                    clientId: keyId,
                    name: client?.name,
                    subject: row.subject,
                    businessID,
                    environment,
                });
            })
            .filter((key): key is ReadKeyDTO => !!key)
            .sort((first, second) => first.client_id.localeCompare(second.client_id));
        return new ReadKeysResponseDTO('Found keys', data);
    }

    /**
     * Replace the secret on a single key. Every other key of the account, and
     * everything else about this one, is left alone.
     */
    async rotate({ keyId, subject, environment: requestedEnvironment }: KeyRequest): Promise<RotateKeyResponseDTO> {
        const { businessID, environment } = await this.getCurrentAccount(subject, requestedEnvironment);
        const keySubject = await this.validateKeyIsHeldByAccount({ keyId, businessID, environment });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const client = await ApiKeyEntity.rotateSecret(keyId, access_token);
        KeysService.logger.log(`Rotated the secret for key: ${keyId} of businessID: ${businessID}`);
        return new RotateKeyResponseDTO({
            message: `Successfully rotated the secret for key: ${keyId}`,
            clientId: keyId,
            clientSecret: client?.client_secret,
            name: client?.name,
            subject: keySubject,
        });
    }

    /**
     * Retire a key for good: the credential is withdrawn at the identity
     * provider and the account it signs in as is taken out of the tenant's
     * configuration, so a caller still presenting it is refused from that
     * moment on.
     */
    async remove({ keyId, subject, environment: requestedEnvironment }: KeyRequest): Promise<DeleteKeyResponseDTO> {
        const { businessID, environment } = await this.getCurrentAccount(subject, requestedEnvironment);
        const keySubject = await this.validateKeyIsHeldByAccount({ keyId, businessID, environment });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        await ApiKeyEntity.deleteClient(keyId, access_token);
        const entity = new UserEntity({
            subject: keySubject,
            businessID,
            environment,
            softDelete: 'deleted',
        });
        const points = UserEntity.transformer(entity, this.InfluxService);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        await cacheManager.del(keySubject);
        KeysService.logger.log(`Deleted key: ${keyId} of businessID: ${businessID}`);
        return new DeleteKeyResponseDTO({
            message: `Successfully deleted key: ${keyId}`,
            clientId: keyId,
            subject: keySubject,
        });
    }
}
