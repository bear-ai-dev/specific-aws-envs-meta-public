import { Controller, Get, Post, Delete, Param, Req, UseGuards, NotFoundException, Logger, Put } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { KeysService } from './keys.service.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UserPermissions } from '../users/user.permissions.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('keys')
export class KeysController {
    private readonly logger = new Logger(KeysController.name);
    constructor(private readonly keysService: KeysService) {}

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'List API keys' })
    async list(@Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        if (!businessID) throw new NotFoundException('BusinessID not resolved');
        const keys = await this.keysService.listKeys(businessID);
        return { message: 'Found keys', data: keys };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate')
    @ApiOperation({ operationId: 'Rotate API key' })
    async rotate(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate-secret')
    @ApiOperation({ operationId: 'Rotate API key (alt)' })
    async rotateAlt(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':clientId/rotate')
    async rotatePut(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':clientId/rotate-secret')
    async rotatePutAlt(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':clientId')
    @ApiOperation({ operationId: 'Retire API key' })
    async retire(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        await this.keysService.retireKey(businessID, clientId);
        return { message: `Retired ${clientId}` };
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/delete')
    async retirePost(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        await this.keysService.retireKey(businessID, clientId);
        return { message: `Retired ${clientId}` };
    }
}

@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('api-keys')
export class ApiKeysAliasController {
    constructor(private readonly keysService: KeysService) {}
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    async list(@Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const keys = await this.keysService.listKeys(businessID);
        return { message: 'Found keys', data: keys };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate')
    async rotate(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate-secret')
    async rotateAlt(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':clientId/rotate')
    async rotatePut(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':clientId')
    async retire(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        await this.keysService.retireKey(businessID, clientId);
        return { message: `Retired ${clientId}` };
    }
}

@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('clients')
export class ClientsAliasController {
    constructor(private readonly keysService: KeysService) {}
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    async list(@Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const keys = await this.keysService.listKeys(businessID);
        return { message: 'Found keys', data: keys };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate')
    async rotate(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate-secret')
    async rotateAlt(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':clientId')
    async retire(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        await this.keysService.retireKey(businessID, clientId);
        return { message: `Retired ${clientId}` };
    }
}

@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('credentials')
export class CredentialsAliasController {
    constructor(private readonly keysService: KeysService) {}
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    async list(@Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const keys = await this.keysService.listKeys(businessID);
        return { message: 'Found keys', data: keys };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate')
    async rotate(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate-secret')
    async rotateAlt(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':clientId')
    async retire(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        await this.keysService.retireKey(businessID, clientId);
        return { message: `Retired ${clientId}` };
    }
}

@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('users/keys')
export class UsersKeysAliasController {
    constructor(private readonly keysService: KeysService) {}
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    async list(@Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const keys = await this.keysService.listKeys(businessID);
        return { message: 'Found keys', data: keys };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate')
    async rotate(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Post(':clientId/rotate-secret')
    async rotateAlt(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        const result = await this.keysService.rotateKey(businessID, clientId);
        return { message: 'Rotated', data: [result] };
    }
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':clientId')
    async retire(@Param('clientId') clientId: string, @Req() req: Request) {
        // @ts-ignore
        const businessID = req?.user?.businessID;
        await this.keysService.retireKey(businessID, clientId);
        return { message: `Retired ${clientId}` };
    }
}
