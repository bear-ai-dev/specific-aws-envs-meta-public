import { Body, Controller, Get, Logger, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { UserPermissions } from './user.permissions.js';
import { EnvironmentService } from './users.service.js';
import { UpdateEnvironmentDto } from './dto/update-environment.dto.js';
import { ReadEnvionmentResponse } from './dto/read-environment.dto.js';
import { UserEntity } from './entities/user.entity.js';

/**
 *
 * This is the environments section.
 *
 * A person works in one environment at a time, sandbox or production, and can
 * move between them. The choice is remembered against them and governs the
 * whole of every request which follows, from the very next one onwards.
 */
@ApiBearerAuth('bearer')
@ApiTags('Environment')
@Controller('users/environment')
export class EnvironmentController {
    private static readonly logger = new Logger(EnvironmentController.name);
    constructor(private readonly environmentService: EnvironmentService) {}

    /**
     * Change the current users environment
     */
    @ApiOkResponse({ status: 200, description: 'Environment updated', type: ReadEnvionmentResponse })
    @UseGuards(AuthGuard('jwt'))
    @Put()
    @ApiOperation({ operationId: 'Update current users enviornment' })
    update(@Body() updateEnvironmentDto: UpdateEnvironmentDto, @Req() request: AuthorizedRequest) {
        const userSubject = request?.user?.sub;
        EnvironmentController.logger.debug(
            `Updating the environment of ${userSubject} to ${updateEnvironmentDto?.environment}`,
        );
        return this.environmentService.updateEnvironment({
            userSubject,
            environment: updateEnvironmentDto?.environment,
        });
    }

    /**
     * Get all user environments
     */
    @ApiOkResponse({ status: 200, type: [UserEntity] })
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Get all environments for a user' })
    findAll(@Req() request: AuthorizedRequest) {
        return this.environmentService.getEnvironmentsForUser(request?.user?.sub);
    }

    /**
     * Change any users environment
     */
    @ApiOkResponse({ status: 200, description: 'Environment updated', type: ReadEnvionmentResponse })
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    @Put('admin')
    @ApiOperation({ operationId: 'Update any users environment' })
    updateForUser(@Body() updateEnvironmentDto: UpdateEnvironmentDto, @Req() request: AuthorizedRequest) {
        const userSubject = updateEnvironmentDto?.userSubject ? updateEnvironmentDto.userSubject : request?.user?.sub;
        return this.environmentService.updateEnvironment({
            userSubject,
            environment: updateEnvironmentDto?.environment,
        });
    }
}
