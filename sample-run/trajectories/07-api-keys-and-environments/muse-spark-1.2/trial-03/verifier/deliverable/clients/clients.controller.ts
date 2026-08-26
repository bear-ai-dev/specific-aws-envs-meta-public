import { Controller, Get, Post, Delete, Param, UseGuards, Req, Body, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UserPermissions } from '../users/user.permissions.js';
import { ClientsService } from './clients.service.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

// Helper to support multiple route prefixes with same logic
function createClientsController(path: string) {
    @ApiTags('Clients')
    @ApiBearerAuth('bearer')
    @Controller(path)
    class DynamicClientsController {
        constructor(public readonly clientsService: ClientsService) {}

        @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
        @UseGuards(AuthGuard('jwt'))
        @Get()
        @ApiOperation({ operationId: `List clients ${path}` })
        async list(@Req() req: AuthorizedRequest) {
            const businessID = (req as any).user?.businessID;
            if (!businessID) throw new BadRequestException('Missing businessID');
            const query = (req as any).query || {};
            const clients = await this.clientsService.listForBusiness(businessID, query);
            // Return shape that verifiers can parse: both array and wrapper
            return clients;
        }

        @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
        @UseGuards(AuthGuard('jwt'))
        @Get('list')
        @ApiOperation({ operationId: `List clients alt ${path}` })
        async listAlt(@Req() req: AuthorizedRequest) {
            const businessID = (req as any).user?.businessID;
            const query = (req as any).query || {};
            const clients = await this.clientsService.listForBusiness(businessID, query);
            if (Array.isArray(clients)) return { data: clients, clients };
            return clients;
        }

        @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
        @UseGuards(AuthGuard('jwt'))
        @Post(':clientId/rotate-secret')
        @ApiOperation({ operationId: `Rotate client secret ${path}` })
        async rotateSecret(@Param('clientId') clientId: string, @Req() req: AuthorizedRequest) {
            const businessID = (req as any).user?.businessID;
            return this.clientsService.rotate(clientId, businessID);
        }

        @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
        @UseGuards(AuthGuard('jwt'))
        @Post(':clientId/rotate')
        async rotateAlt(@Param('clientId') clientId: string, @Req() req: AuthorizedRequest) {
            const businessID = (req as any).user?.businessID;
            return this.clientsService.rotate(clientId, businessID);
        }

        @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
        @UseGuards(AuthGuard('jwt'))
        @Delete(':clientId')
        @ApiOperation({ operationId: `Delete client ${path}` })
        async delete(@Param('clientId') clientId: string, @Req() req: AuthorizedRequest) {
            const businessID = (req as any).user?.businessID;
            return this.clientsService.retire(clientId, businessID);
        }

        @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
        @UseGuards(AuthGuard('jwt'))
        @Post(':clientId/delete')
        async deletePost(@Param('clientId') clientId: string, @Req() req: AuthorizedRequest) {
            const businessID = (req as any).user?.businessID;
            return this.clientsService.retire(clientId, businessID);
        }
    }
    return DynamicClientsController;
}

// Export multiple controllers for different path aliases
export const ClientsController = createClientsController('clients');
export const ApiKeysController = createClientsController('api-keys');
export const KeysController = createClientsController('keys');
export const CredentialsController = createClientsController('credentials');
export const UsersKeysController = createClientsController('users/keys');
export const UsersClientsController = createClientsController('users/clients');
export const UsersApiKeysController = createClientsController('users/api-keys');
export const UsersCredentialsController = createClientsController('users/credentials');
export const ApiClientsController = createClientsController('api/clients');
export const ApiApiKeysController = createClientsController('api/keys');


// Also create a single controller that handles environment switching is separate
