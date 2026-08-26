import { Controller, Get, Put, Delete, Param, Req, UseGuards, Logger, NotFoundException } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { KeysService } from './keys.service.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UserPermissions } from '../users/user.permissions.js';

@ApiBearerAuth('bearer')
@ApiTags('Keys')
@Controller('keys')
export class KeysController {
    private static readonly logger = new Logger(KeysController.name);
    constructor(private readonly keysService: KeysService) {}

    @Get()
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Find all keys in the account' })
    async findAll(@Req() request: Request) {
        // businessID is set by BusinessIDInterceptor based on current environment
        // @ts-ignore
        const businessID = request.user?.businessID;
        // @ts-ignore
        const sub = request.user?.sub;
        KeysController.logger.log(`Listing keys for businessID ${businessID} subject ${sub}`);
        if (!businessID) {
            // If no businessID resolved, return empty or throw
            throw new NotFoundException('Business account not found for current environment');
        }
        const clients = await this.keysService.findAll(businessID);
        return clients;
    }

    @Put(':keyId')
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    async rotate(@Param('keyId') keyId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request.user?.businessID;
        if (!businessID) throw new NotFoundException('Business account not found');
        KeysController.logger.log(`Rotating key ${keyId} for businessID ${businessID}`);
        const result = await this.keysService.rotateSecret(keyId, businessID);
        return result;
    }

    @Delete(':keyId')
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @ApiOperation({ operationId: 'Delete a user key' })
    async delete(@Param('keyId') keyId: string, @Req() request: Request) {
        // @ts-ignore
        const businessID = request.user?.businessID;
        // @ts-ignore
        const env = request.user?.environment; // not needed; service will derive
        if (!businessID) throw new NotFoundException('Business account not found');
        KeysController.logger.log(`Deleting key ${keyId} for businessID ${businessID}`);
        const result = await this.keysService.deleteKey(keyId, businessID);
        return result;
    }
}
