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
    /**
     * Moves the user into the given environment. The environment which is written here
     * is what every subsequent request made by the user resolves its account, and
     * therefore its data, against. Any cached account information for the user is
     * dropped so the change takes effect on the very next request.
     */
    async updateEnvironment({
        userSubject,
        environment,
    }: {
        userSubject: string;
        environment?: Environment;
    }): Promise<ReadEnvionmentResponse> {
        if (!userSubject) {
            throw new BadRequestException('A subject is required to update an environment');
        }
        const { loadPoints } = this.InfluxService;
        const entity = new EnvironmentEntity({ subject: userSubject, environment });
        const pointsArray = EnvironmentEntity.transformer(entity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, pointsArray);
        // The users account is cached per subject, it must be dropped so the very next
        // request resolves the account of the newly chosen environment.
        await cacheManager.del(userSubject);
        EnvironmentService.logger.log(`Updated environment for subject: ${userSubject} to ${entity.environment}`);
        return { message: 'Environment updated', ...entity };
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
