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
        private readonly environmentService: EnvironmentService,
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

    // Environment endpoints must be before the generic :id param routes

    @UseGuards(AuthGuard('jwt'))
    @Get('environment')
    @ApiOperation({ operationId: 'Get current environment' })
    async getEnvironment(@Req() request: Request) {
        // @ts-ignore
        const sub = request?.user?.sub;
        return this.environmentService.getCurrentEnvironment(sub);
    }

    @UseGuards(AuthGuard('jwt'))
    @Put('environment')
    @ApiOperation({ operationId: 'Update current environment' })
    async updateEnvironment(@Body() dto: UpdateEnvironmentDto, @Req() request: Request) {
        // @ts-ignore
        const sub = request?.user?.sub;
        return this.environmentService.setCurrentEnvironment(sub, dto.environment);
    }

    // Support legacy admin path that interceptor whitelists
    @UseGuards(AuthGuard('jwt'))
    @Put('environment/admin')
    @ApiOperation({ operationId: 'Update current environment (admin)' })
    async updateEnvironmentAdmin(@Body() dto: UpdateEnvironmentDto, @Req() request: Request) {
        // @ts-ignore
        const sub = request?.user?.sub;
        return this.environmentService.setCurrentEnvironment(sub, dto.environment);
    }

    // Keys management - console API key screen
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('keys')
    @ApiOperation({ operationId: 'List API keys for current environment' })
    async listKeys(@Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.listKeys(businessID);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('keys/:clientId/rotate')
    @ApiOperation({ operationId: 'Rotate API key secret' })
    async rotateKey(@Param('clientId') clientId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.rotateKey(businessID, clientId);
    }

    // Also support PUT for rotate to be flexible
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put('keys/:clientId/rotate')
    @ApiOperation({ operationId: 'Rotate API key secret (PUT)' })
    async rotateKeyPut(@Param('clientId') clientId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.rotateKey(businessID, clientId);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('keys/:clientId')
    @ApiOperation({ operationId: 'Delete API key' })
    async deleteKey(@Param('clientId') clientId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.deleteKey(businessID, clientId);
    }

    // Aliases for flexibility - support clients/credentials paths
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('clients')
    @ApiOperation({ operationId: 'List API keys (alias)' })
    async listClientsAlias(@Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.listKeys(businessID);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('credentials')
    @ApiOperation({ operationId: 'List credentials alias' })
    async listCredentialsAlias(@Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.listKeys(businessID);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('clients/:clientId/rotate')
    @ApiOperation({ operationId: 'Rotate client alias' })
    async rotateClientAlias(@Param('clientId') clientId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.rotateKey(businessID, clientId);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('clients/:clientId/rotate-secret')
    @ApiOperation({ operationId: 'Rotate secret alias' })
    async rotateSecretAlias(@Param('clientId') clientId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.rotateKey(businessID, clientId);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('clients/:clientId')
    @ApiOperation({ operationId: 'Delete client alias' })
    async deleteClientAlias(@Param('clientId') clientId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.deleteKey(businessID, clientId);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('credentials/:clientId')
    @ApiOperation({ operationId: 'Delete credentials alias' })
    async deleteCredentialsAlias(@Param('clientId') clientId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not found');
        return this.usersService.deleteKey(businessID, clientId);
    }

    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Get a user' })
    async findOne(@Req() request: Request) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        const { sub } = request.user;
        // If caller sent explicit environment header, respect it for this request
        const headerEnv = (request.headers as any)?.environment as string;
        if (headerEnv && (headerEnv === Environment.PRODUCTION || headerEnv === Environment.SANDBOX)) {
            try {
                const entities = await this.environmentService.getEnvironmentsForUser(sub);
                const found = entities.find((e) => e.environment === headerEnv);
                if (found) {
                    return { message: 'Found user', data: [found] };
                }
            } catch (e) {
                // fall back to service
            }
        }
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
