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

/**
 * The resolution of a subject to an account is cached, and because the account a
 * subject resolves to depends on the environment the subject is currently in,
 * the environment is part of the cache key. Anything which changes that
 * resolution -- moving between environments, retiring a credential, or
 * reassigning a subject to another account -- drops every entry for the subject
 * so the change is visible on the very next request.
 */
export const userCacheKey = (subject: string, environment?: Environment): string =>
    environment ? `${subject}-${environment}` : subject;

export const invalidateUserCache = async (subject: string): Promise<void> => {
    if (!subject) {
        return;
    }
    await cacheManager.del(subject);
    await Promise.all(
        Object.values(Environment).map((environment) => cacheManager.del(userCacheKey(subject, environment))),
    );
};

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
    /**
     * Moves a person between the environments their account holds.
     *
     * The choice is stored against the person's subject, and nothing else about
     * a request carries it, so it governs the whole of every request which
     * follows: the account the request resolves to, the credentials listed back
     * and the data reachable through them. Any cached resolution for the
     * subject is dropped so the move takes effect on the very next request
     * rather than whenever a cache entry happens to expire.
     */
    async updateEnvironment({
        userSubject,
        environment,
    }: {
        userSubject: string;
        environment: Environment;
    }): Promise<ReadEnvionmentResponse> {
        if (!userSubject) {
            throw new UnauthorizedException();
        }
        if (!Object.values(Environment).includes(environment)) {
            throw new BadRequestException(`Invalid Environment chosen: ${environment}`);
        }
        const environments = await this.getEnvironmentsForUser(userSubject);
        const chosen = environments.find((entity) => entity.environment === environment);
        if (!chosen) {
            EnvironmentService.logger.warn(`No account found for environment: ${environment}`);
            throw new BadRequestException(`Invalid Environment chosen: ${environment}`);
        }

        const { loadPoints } = this.InfluxService;
        const entity = new EnvironmentEntity({ subject: userSubject, environment });
        const pointsArray = EnvironmentEntity.transformer(entity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, pointsArray);
        await invalidateUserCache(userSubject);
        EnvironmentService.logger.log(`Updated environment for ${userSubject} to ${environment}`);
        return { message: 'Environment updated', subject: userSubject, environment };
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
        // The configuration for the subject just changed, so anything cached
        // for it is stale from this moment onwards.
        await invalidateUserCache(subject);
        // Return message
        return { message: 'sucessfully uploaded user config' };
    }

    async findOne(readUserDTO: ReadUserDTO): Promise<ReadResponseDTO> {
        // Given a subject
        const { subject } = readUserDTO;
        // The account a subject resolves to follows the environment the subject
        // is currently in, so the environment is resolved first and is part of
        // the cache key.
        const { environment } = await this.environmentService.getCurrentEnvironment(subject);
        const cacheKey = userCacheKey(subject, environment);

        let userEntity = await cacheManager.get(cacheKey);
        if (!userEntity) {
            UsersService.logger.warn(`UserEntity for subject: ${subject} not in cache`);
            // Read User's current ENV
            const results = await this.getCurrentUserConfigFromDb(subject, environment);
            if (results.length === 0) {
                throw new UnauthorizedException();
            }
            userEntity = UserEntity.dbModelToEntity(results);
            await cacheManager.set(cacheKey, JSON.stringify(userEntity), 604800);
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
    async getCurrentUserConfigFromDb(subject, currentEnvironment?: Environment): Promise<Array<any>> {
        let environment = currentEnvironment;
        if (!environment) {
            ({ environment } = await this.environmentService.getCurrentEnvironment(subject));
        }
        const { readUserData } = this.InfluxService;
        const results = await readUserData(subject, environment);
        return results;
    }

    /**
     * Takes the account a subject signs in as out of the tenant's configuration.
     *
     * The configuration store is append only, so the removal is written as a new
     * newest row carrying the soft delete marker, which every read of the
     * configuration filters out. The cached resolution for the subject is
     * dropped as well, so a caller still presenting a credential which signs in
     * as this subject is refused from this moment onwards.
     */
    async softDelete({
        subject,
        businessID,
        environment,
    }: {
        subject: string;
        businessID: string;
        environment?: Environment;
    }): Promise<BasicResponseDTO> {
        const { loadPoints } = this.InfluxService;
        const userEntity = new UserEntity({ subject, businessID, environment, softDelete: 'deleted' });
        const pointsArray = UserEntity.transformer(userEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, pointsArray);
        await invalidateUserCache(subject);
        return { message: `sucessfully removed the account for subject: ${subject}` };
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
