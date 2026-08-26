import { Controller, Get, Put, Body, Req, UseGuards, Logger } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { EnvironmentService } from './users.service.js';
import { UpdateEnvironmentDto } from './dto/update-environment.dto.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UserPermissions } from './user.permissions.js';

@ApiBearerAuth('bearer')
@ApiTags('Environment')
@Controller('users/environment')
export class EnvironmentController {
    private static readonly logger = new Logger(EnvironmentController.name);
    constructor(private readonly environmentService: EnvironmentService) {}

    @Get()
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Get all environments for a user' })
    async getAll(@Req() request: Request) {
        // @ts-ignore
        const sub = request.user?.sub;
        return this.environmentService.getEnvironmentsForUser(sub);
    }

    @Put()
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Update current users enviornment' })
    async updateCurrent(@Body() dto: UpdateEnvironmentDto, @Req() request: Request) {
        // @ts-ignore
        const sub = request.user?.sub;
        const env = dto.environment;
        EnvironmentController.logger.log(`Updating current env for ${sub} to ${env}`);
        return this.environmentService.updateEnvironment(sub, env);
    }
}

@ApiBearerAuth('bearer')
@ApiTags('Environment')
@Controller('users/environment/admin')
export class EnvironmentAdminController {
    private static readonly logger = new Logger(EnvironmentAdminController.name);
    constructor(private readonly environmentService: EnvironmentService) {}

    @Put()
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Update any users environment' })
    async updateAny(@Body() dto: UpdateEnvironmentDto, @Req() request: Request) {
        const subject = dto.userSubject;
        const env = dto.environment;
        if (!subject) {
            // If no subject provided, fallback to current user (should not happen per spec expects userSubject required)
            // @ts-ignore
            const sub = request.user?.sub;
            EnvironmentAdminController.logger.log(`Admin updating own env fallback ${sub} to ${env}`);
            return this.environmentService.updateEnvironment(sub, env);
        }
        EnvironmentAdminController.logger.log(`Admin updating env for ${subject} to ${env}`);
        return this.environmentService.updateEnvironment(subject, env);
    }
}
