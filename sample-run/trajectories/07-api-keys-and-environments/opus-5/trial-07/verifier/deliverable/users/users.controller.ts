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
import { EnvironmentService, KeysService, OrganizationService, UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiNotFoundResponse,
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
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { ApiForbiddenResponse, ApiOkResponse } from '@nestjs/swagger';

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
 * This is the environment section. A person works in one environment of their
 * account at a time and can move between them, and that choice governs the
 * whole of every request which follows it.
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
    updateAnyEnvironment(@Body() updateEnvironmentDto: UpdateEnvironmentDto) {
        return this.environmentService.update(updateEnvironmentDto);
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
    updateEnvironment(@Body() updateEnvironmentDto: UpdateEnvironmentDto, @Req() request: AuthorizedRequest) {
        // The environment can only ever be switched for the signed in user, no
        // matter what the body of the request asks for.
        return this.environmentService.update({ ...updateEnvironmentDto, userSubject: request?.user?.sub });
    }

    /**
     * Get all user environments
     */
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Get all environments for a user' })
    getEnvironments(@Req() request: AuthorizedRequest) {
        return this.environmentService.getEnvironmentsForUser(request?.user?.sub);
    }
}

/**
 *
 * This is the keys section. A key is a machine credential held by the account
 * the caller resolves to, in the environment they are currently in. Listing is
 * a read, rotating a secret and retiring a key are administrative acts.
 */
@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('keys')
export class KeysController {
    constructor(private readonly keysService: KeysService) {}

    /**
     * Find every key the account holds in the environment you are in
     */
    @ApiForbiddenResponse({ status: 403, description: 'Permission denied' })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    findAll(@Req() request: AuthorizedRequest) {
        return this.keysService.findAll({
            subject: request?.user?.sub,
            environment: request?.headers?.environment as string,
        });
    }

    /**
     * Rotate the secret of a single key which may have leaked
     */
    @ApiOkResponse({ status: 200, description: 'Secret rotated', type: BasicResponseDTO })
    @ApiNotFoundResponse({ status: 404, description: 'Key Not Found' })
    @ApiForbiddenResponse({ status: 403, description: 'Permission denied' })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    rotate(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        return this.keysService.rotate({
            keyId,
            subject: request?.user?.sub,
            environment: request?.headers?.environment as string,
        });
    }

    /**
     * Retire a key for good once an integration is decommissioned
     */
    @ApiOkResponse({ status: 200, description: 'Key deleted', type: BasicResponseDTO })
    @ApiNotFoundResponse({ status: 404, description: 'Key Not Found' })
    @ApiForbiddenResponse({ status: 403, description: 'Permission denied' })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    remove(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        return this.keysService.remove({
            keyId,
            subject: request?.user?.sub,
            environment: request?.headers?.environment as string,
        });
    }
}
