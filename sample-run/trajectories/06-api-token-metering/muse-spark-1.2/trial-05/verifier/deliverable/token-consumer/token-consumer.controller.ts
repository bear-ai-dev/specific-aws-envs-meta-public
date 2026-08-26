import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Req } from '@nestjs/common';
import { TokenConsumerService } from './token-consumer.service';
import { PermissionsGuard } from '../authz/PermissionsGaurd';
import { UserPermissions } from '../users/user.permissions';
import { AuthGuard } from '@nestjs/passport';
import { AdminScheduleTokenDto } from './dto/adminScheduleToken.dto';
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

    @Delete('schedule')
    @UseGuards(PermissionsGuard([UserPermissions.ADMIN]))
    @UseGuards(AuthGuard('jwt'))
    async delete(@Body() adminScheduleTokenDto: AdminScheduleTokenDto) {
        await this.tokenConsumerService.removeTokenProcessor(adminScheduleTokenDto);
        return { message: 'successfully removed schedulers' };
    }
}
