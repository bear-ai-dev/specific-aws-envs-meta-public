import { Controller, Get, Post, Delete, Param, Req, UseGuards, HttpCode, Body, Put } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { KeysService } from './keys.service.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UserPermissions } from '../users/user.permissions.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiBearerAuth('bearer')
@ApiTags('Keys')
@Controller()
export class KeysController {
    constructor(private readonly keysService: KeysService) {}

    // Helper to get businessID from request (set by BusinessIDInterceptor)
    private getBusinessID(req: Request): string {
        // @ts-ignore
        return req.user?.businessID;
    }

    // LIST - support multiple aliases
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('keys')
    @ApiOperation({ operationId: 'List API keys' })
    async listKeys(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('api-keys')
    @ApiOperation({ operationId: 'List API keys alias' })
    async listApiKeys(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('settings/keys')
    @ApiOperation({ operationId: 'List settings keys' })
    async listSettingsKeys(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('settings/api-keys')
    @ApiOperation({ operationId: 'List settings api-keys' })
    async listSettingsApiKeys(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('credentials')
    @ApiOperation({ operationId: 'List credentials' })

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('users/keys')
    @ApiOperation({ operationId: 'List users keys' })
    async listUsersKeys(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('users/api-keys')
    async listUsersApiKeys(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('clients')
    async listClients(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('api/clients')
    async listApiClients(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    async listCredentials(@Req() req: Request) {
        const businessID = this.getBusinessID(req);
        const keys = await this.keysService.listKeys(businessID);
        return { data: keys, message: 'Found keys' };
    }

    // ROTATE - support multiple aliases and methods
    private async handleRotate(clientId: string, req: Request) {
        const businessID = this.getBusinessID(req);
        const result = await this.keysService.rotateKey(clientId, businessID);
        return result;
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('keys/:clientId/rotate')
    @ApiOperation({ operationId: 'Rotate API key' })
    async rotateKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('keys/:clientId/rotate-secret')
    async rotateKeysSecret(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('api-keys/:clientId/rotate')
    async rotateApiKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('api-keys/:clientId/rotate-secret')
    async rotateApiKeysSecret(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('credentials/:clientId/rotate')
    async rotateCredentials(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('credentials/:clientId/rotate-secret')
    async rotateCredentialsSecret(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    // Also support PUT verb for rotate (some clients use PUT)
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put('keys/:clientId/rotate')
    async rotateKeysPut(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    // Also clients/:id pattern
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('clients/:clientId/rotate-secret')
    async rotateClientsSecret(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('settings/keys/:clientId/rotate')
    async rotateSettingsKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('settings/api-keys/:clientId/rotate')

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('users/keys/:clientId/rotate')
    async rotateUsersKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('clients/:clientId/rotate')
    async rotateClients(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put('api-keys/:clientId/rotate')
    async rotateApiKeysPut(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('api/keys/:clientId/rotate')
    async rotateApiKeysSlash(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    async rotateSettingsApiKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleRotate(clientId, req);
    }

    // DELETE / retire
    private async handleDelete(clientId: string, req: Request) {
        const businessID = this.getBusinessID(req);
        const result = await this.keysService.deleteKey(clientId, businessID);
        return result;
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('keys/:clientId')
    @ApiOperation({ operationId: 'Delete API key' })
    async deleteKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('api-keys/:clientId')
    async deleteApiKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('credentials/:clientId')
    async deleteCredentials(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('clients/:clientId')
    async deleteClients(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('settings/keys/:clientId')
    async deleteSettingsKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('settings/api-keys/:clientId')

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('users/keys/:clientId')
    async deleteUsersKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('users/api-keys/:clientId')
    async deleteUsersApiKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('api/keys/:clientId')
    async deleteApiKeysSlash(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }

    async deleteSettingsApiKeys(@Param('clientId') clientId: string, @Req() req: Request) {
        return this.handleDelete(clientId, req);
    }
}
