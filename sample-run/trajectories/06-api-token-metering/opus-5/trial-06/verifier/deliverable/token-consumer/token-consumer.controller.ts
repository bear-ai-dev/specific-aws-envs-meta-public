import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { TokenConsumerService } from './token-consumer.service';
import { PermissionsGuard } from '../authz/PermissionsGaurd';
import { UserPermissions } from '../users/user.permissions';
import { AuthGuard } from '@nestjs/passport';
import { AdminAggregateTokenDto, AdminScheduleTokenDto } from './dto/adminScheduleToken.dto';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd';

@Controller('meteringco/token')
export class TokenConsumerController {
    constructor(private readonly tokenConsumerService: TokenConsumerService) {}

    @Get()
    @UseGuards(AuthGuard('jwt'))
    findAll(@Req() request: AuthorizedRequest) {
        const { businessID } = request.user;
        return this.tokenConsumerService.findAll({ businessID });
    }
    @Post('schedule')
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    async create(@Body() adminScheduleTokenDto: AdminScheduleTokenDto) {
        await this.tokenConsumerService.scheduleTokenProcessor(adminScheduleTokenDto);
        return { message: 'successfully set schedulers' };
    }

    /**
     * Closes a metering period for a single meteringco customer: everything registered inside the window is
     * totalled into one token, which becomes billable usage against meteringco's own account. When no window
     * is provided the six hours behind the call are closed.
     */
    @Post('aggregate')
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    async aggregate(@Body() adminAggregateTokenDto: AdminAggregateTokenDto) {
        const res = await this.tokenConsumerService.aggregateTokens(adminAggregateTokenDto);
        return res ? res : { message: 'no tokens aggregated' };
    }

    @Delete('schedule')
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    async delete(@Body() adminScheduleTokenDto: AdminScheduleTokenDto) {
        await this.tokenConsumerService.removeTokenProcessor(adminScheduleTokenDto);
        return { message: 'successfully removed schedulers' };
    }
}
