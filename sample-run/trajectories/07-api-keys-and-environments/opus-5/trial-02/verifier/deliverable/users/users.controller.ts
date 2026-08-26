import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    UseGuards,
    Req,
    ConflictException,
    Res,
    Put,
    NotFoundException,
    Delete,
    UnauthorizedException,
    Logger,
    InternalServerErrorException,
} from '@nestjs/common';
import { EnvironmentService, OrganizationService, UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { UserPermissions } from './user.permissions.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { LoginGuard } from '../authz/login.gaurd.js';
import { sendEmail } from '../utils/aws/ses.js';
import { CreateOrganizationDto } from './dto/create-organization.dto.js';
import { OrganizationPermissions } from './organization.permissions.js';
import { UpdateOrganizationDto } from './dto/update-organization.dto.js';
import { OrganizationResponseDto } from './dto/organization-response.dto.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { Environment } from './dto/Environment.js';
import { AuditService } from '../audit/audit.service.js';
import { serializeError } from 'serialize-error';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { OnboardingEntity } from './entities/onboarding.entity.js';
import { UpdateEnvironmentDto } from './dto/update-environment.dto.js';
import { ReadEnvionmentResponse } from './dto/read-environment.dto.js';
import { UserEntity } from './entities/user.entity.js';
import { KeysService } from './keys.service.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';

/**
 *
 * This is the users section
 */
@ApiBearerAuth('bearer')
@Controller('users')
@ApiTags('Users')
export class UsersController {
    private static logger = new Logger(UsersController.name);
    constructor(
        private readonly usersService: UsersService,
        private readonly onboardingEntity: OnboardingEntity,
    ) {}

    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    @Post()
    @ApiOperation({ operationId: 'Create a user' })
    create(@Body() createUserDto: CreateUserDto) {
        return this.usersService.create(createUserDto);
    }
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    @Get('all')
    @ApiOperation({ operationId: 'Find All Users' })
    findAll() {
        return this.usersService.findAll();
    }

    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Get a user' })
    findOne(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { sub } = request.user;
        return this.usersService.findOne({ subject: sub });
    }

    @UseGuards(AuthGuard('jwt'))
    @Delete()
    @ApiOperation({ operationId: 'Delete a user' })
    delete(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { sub } = request.user;
        return this.usersService.findOne({ subject: sub });
    }

    @UseGuards(LoginGuard)
    @Get('login')
    @ApiOperation({ operationId: 'Get user login' })
    userLogin(@Req() request: Request) {
        // No Operation, taken care of in the LoginGuard for the redirect
    }

    @UseGuards(LoginGuard)
    @Get('redirect')
    @ApiOperation({ operationId: 'Get redirection link for signin' })
    async userRedirect(@Param() something, @Req() request: AuthorizedRequest, @Res() res) {
        try {
            await this.usersService.findOne({ subject: request?.user?.sub });
            return res.redirect(
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore
                `https://dashboard.meteringco.example?token=${request?.user?.access_token}`,
            );
        } catch (e) {
            if (e instanceof UnauthorizedException) {
                // Create a businessID 12 character hash for the user

                if (request?.user?.sub && !request?.user?.businessID) {
                    try {
                        const results = await this.usersService.getCurrentUserConfigFromDb(request?.user?.sub);
                        if (results.length === 0) {
                            let businessID;
                            let users;
                            do {
                                businessID = Math.random().toString(36).substring(2, 15);
                                users = await this.usersService.findAllUsersForBusinessID({ businessID });
                            } while (users?.data?.length > 0);
                            await Promise.all([
                                await this.usersService.create({
                                    subject: request?.user?.sub,
                                    businessID: `${businessID}-production`,
                                    environment: Environment.PRODUCTION,
                                }),
                                await this.usersService.create({
                                    subject: request?.user?.sub,
                                    businessID: `${businessID}-sandbox`,
                                    environment: Environment.SANDBOX,
                                }),
                                await this.onboardingEntity.onboardNewUserToDogfood({
                                    businessID: `${businessID}-production`,
                                    sub: request?.user?.sub,
                                }),
                            ]);

                            return res.redirect(
                                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                //@ts-ignore
                                `https://dashboard.meteringco.example?token=${request?.user?.access_token}`,
                            );
                        }
                    } catch (e) {
                        UsersController.logger.error(`Failed to create a new businessID`);
                        UsersController.logger.error(serializeError(e));
                        AuditService.publishEvent({
                            data: [{ error: serializeError(e) }],
                            message: `Failed to create a new businessID for a user. Sub: ${request?.user?.sub}`,
                            topic: AuditScope.ERROR,
                        });
                        throw new InternalServerErrorException(`Failed to create a new user`);
                    }
                } else {
                    UsersController.logger.warn(`User already has existing businessID but is Unauthorized`);
                    UsersController.logger.warn(serializeError(e));
                    throw e;
                }
            } else {
                UsersController.logger.error(`Failed to Login a user`);
                UsersController.logger.error(serializeError(e));
                AuditService.publishEvent({
                    data: [{ error: serializeError(e) }],
                    message: `Failed to login a user. Sub: ${request?.user?.sub}`,
                    topic: AuditScope.ERROR,
                });
                throw e;
            }
        }
    }
}

/**
 *
 * This is the organizations section
 */
@ApiTags('Oranizations')
@ApiBearerAuth('bearer')
@Controller('users/organizations')
export class OrganizationController {
    constructor(private readonly organizationService: OrganizationService) {}

    /**
     * Create an organization for your account
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'Organization created',
        type: OrganizationResponseDto,
    })
    @ApiBadRequestResponse({
        status: 400,
        description: 'Organization already exists',
    })
    @UseGuards(AuthGuard('jwt'))
    @Post()
    @ApiOperation({ operationId: 'Create organization' })
    create(@Body() createOrganizationDto: CreateOrganizationDto, @Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const sub = request?.user?.sub;
        return this.organizationService.create({ ...createOrganizationDto, subjects: [sub] });
    }

    /**
     * Find your organization
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'Organization found',
        type: OrganizationResponseDto,
    })
    @ApiNotFoundResponse({
        status: 404,
        description: 'Organization Not Found',
        type: NotFoundException,
    })
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Get organization for user' })
    findOne(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const businessID = request?.user?.businessID;
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        console.log(request?.user, businessID);
        return this.organizationService.findOne(businessID);
    }

    /**
     * Add users to your organization, or update the organization display name
     */
    @ApiCreatedResponse({
        status: 201,
        description: 'Organization updated',
        type: OrganizationResponseDto,
    })
    @UseGuards(PermissionsGuard([OrganizationPermissions.UPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put()
    @ApiOperation({ operationId: 'Update organization' })
    update(@Body() updateOrganizationDto: UpdateOrganizationDto, @Req() request: AuthorizedRequest) {
        return this.organizationService.update({
            ...updateOrganizationDto,
            businessID: request?.user?.businessID,
            subject: request?.user?.sub,
        });
    }
}

/**
 *
 * This is the environments section.
 *
 * A tenant integrates against two separate environments, a sandbox for trying things out
 * and production for real traffic, and each is a separate account with its own customers,
 * usage and billing behind it. A person signed in to the console works in one environment
 * at a time and can move between them with the endpoints below.
 */
@ApiTags('Environment')
@ApiBearerAuth('bearer')
@Controller('users/environment')
export class EnvironmentController {
    constructor(private readonly environmentService: EnvironmentService) {}

    /**
     * Change any users environment
     */
    @ApiOkResponse({
        status: 200,
        description: 'Environment updated',
        type: ReadEnvionmentResponse,
    })
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    @Put('admin')
    @ApiOperation({ operationId: 'Update any users environment' })
    updateEnvironmentForUser(@Body() updateEnvironmentDto: UpdateEnvironmentDto): Promise<ReadEnvionmentResponse> {
        return this.environmentService.updateEnvironment({
            subject: updateEnvironmentDto?.userSubject,
            environment: updateEnvironmentDto?.environment,
        });
    }

    /**
     * Change the current users environment
     */
    @ApiOkResponse({
        status: 200,
        description: 'Environment updated',
        type: ReadEnvionmentResponse,
    })
    @UseGuards(AuthGuard('jwt'))
    @Put()
    @ApiOperation({ operationId: 'Update current users enviornment' })
    updateEnvironment(
        @Body() updateEnvironmentDto: UpdateEnvironmentDto,
        @Req() request: AuthorizedRequest,
    ): Promise<ReadEnvionmentResponse> {
        return this.environmentService.updateEnvironment({
            subject: request?.user?.sub,
            environment: updateEnvironmentDto?.environment,
        });
    }

    /**
     * Get all user environments
     */
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Get all environments for a user' })
    getEnvironments(@Req() request: AuthorizedRequest): Promise<UserEntity[]> {
        return this.environmentService.getEnvironmentsForUser(request?.user?.sub);
    }
}

/**
 *
 * This is the keys section.
 *
 * The machine credentials of an account, in the environment the caller is currently in.
 * A tenant administrator can see the credentials their account holds, ask for a fresh
 * secret on one which may have leaked, and retire one for good when an integration is
 * decommissioned. Listing only needs the right to read keys, while rotating and retiring
 * are administrative acts.
 */
@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('keys')
export class KeysController {
    private static logger = new Logger(KeysController.name);
    constructor(private readonly keysService: KeysService) {}

    /**
     * Find all of the keys the account holds in the current environment
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    findAll(@Req() request: AuthorizedRequest) {
        return this.keysService.findAll({ businessID: request?.user?.businessID });
    }

    /**
     * Retire a key for good
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    remove(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest): Promise<BasicResponseDTO> {
        KeysController.logger.log(`Deleting key: ${keyId} for account: ${request?.user?.businessID}`);
        return this.keysService.remove({ businessID: request?.user?.businessID, keyId });
    }

    /**
     * Rotate the secret of a single key
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    rotate(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest): Promise<BasicResponseDTO> {
        KeysController.logger.log(`Rotating key: ${keyId} for account: ${request?.user?.businessID}`);
        return this.keysService.rotate({ businessID: request?.user?.businessID, keyId });
    }
}
