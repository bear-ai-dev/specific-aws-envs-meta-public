import { Controller, Get, Post, Delete, Param, UseGuards, Req, NotFoundException, Body } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { KeysService } from './keys.service.js';
import { UserPermissions } from '../users/user.permissions.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller()
export class KeysController {
    constructor(private readonly keysService: KeysService) {}

    private getCtx(req: Request): { businessID: string; subject: string } {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        // @ts-ignore
        const subject = req?.user?.sub;
        if (!subject) throw new NotFoundException('User not found');
        if (!businessID) throw new NotFoundException('Business not found');
        return { businessID, subject };
    }

    // Primary path: GET /keys and aliases
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('keys')
    @ApiOperation({ operationId: 'List keys' })
    async listKeys(@Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        const data = await this.keysService.listKeysForBusiness(businessID, subject);
        // Return in common format: support both array and object
        // Provide { message, data } as well as raw array via alias
        return { message: 'Found keys', data, clients: data };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('api-keys')
    @ApiOperation({ operationId: 'List api-keys alias' })
    async listApiKeys(@Req() req: Request) {
        return this.listKeys(req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('credentials')
    @ApiOperation({ operationId: 'List credentials alias' })
    async listCredentials(@Req() req: Request) {
        return this.listKeys(req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('clients')
    @ApiOperation({ operationId: 'List clients alias' })
    async listClients(@Req() req: Request) {
        return this.listKeys(req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('users/keys')
    @ApiOperation({ operationId: 'List users keys alias' })
    async listUsersKeys(@Req() req: Request) {
        return this.listKeys(req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('users/api-keys')
    async listUsersApiKeys(@Req() req: Request) {
        return this.listKeys(req);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get('console/keys')
    async listConsoleKeys(@Req() req: Request) {
        return this.listKeys(req);
    }

    // Rotate - support multiple paths
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('keys/:id/rotate-secret')
    @ApiOperation({ operationId: 'Rotate key secret' })
    async rotateSecret(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        const result = await this.keysService.rotateKey(id, businessID, subject);
        return result;
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('keys/:id/rotate')
    async rotate(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        const result = await this.keysService.rotateKey(id, businessID, subject);
        return result;
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('api-keys/:id/rotate-secret')
    async rotateApiKeysSecret(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        return this.keysService.rotateKey(id, businessID, subject);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('api-keys/:id/rotate')
    async rotateApiKeys(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        return this.keysService.rotateKey(id, businessID, subject);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('credentials/:id/rotate-secret')
    async rotateCredSecret(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        return this.keysService.rotateKey(id, businessID, subject);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('credentials/:id/rotate')
    async rotateCred(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        return this.keysService.rotateKey(id, businessID, subject);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('users/keys/:id/rotate-secret')
    async rotateUsersKeysSecret(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        return this.keysService.rotateKey(id, businessID, subject);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('users/keys/:id/rotate')
    async rotateUsersKeys(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        return this.keysService.rotateKey(id, businessID, subject);
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post('clients/:id/rotate-secret')
    async rotateClientsSecret(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        return this.keysService.rotateKey(id, businessID, subject);
    }

    // Delete / retire variants
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('keys/:id')
    @ApiOperation({ operationId: 'Delete key' })
    async deleteKey(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        await this.keysService.deleteKey(id, businessID, subject);
        return { message: 'Key retired successfully' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('api-keys/:id')
    async deleteApiKey(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        await this.keysService.deleteKey(id, businessID, subject);
        return { message: 'Key retired successfully' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('credentials/:id')
    async deleteCred(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        await this.keysService.deleteKey(id, businessID, subject);
        return { message: 'Key retired successfully' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('clients/:id')
    async deleteClient(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        await this.keysService.deleteKey(id, businessID, subject);
        return { message: 'Key retired successfully' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('users/keys/:id')
    async deleteUsersKey(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        await this.keysService.deleteKey(id, businessID, subject);
        return { message: 'Key retired successfully' };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete('users/api-keys/:id')
    async deleteUsersApiKey(@Param('id') id: string, @Req() req: Request) {
        const { businessID, subject } = this.getCtx(req);
        await this.keysService.deleteKey(id, businessID, subject);
        return { message: 'Key retired successfully' };
    }
}
