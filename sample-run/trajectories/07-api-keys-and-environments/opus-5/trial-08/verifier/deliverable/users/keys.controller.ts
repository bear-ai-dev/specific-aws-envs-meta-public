import { Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { KeysService } from './keys.service.js';
import { UserPermissions } from './user.permissions.js';

/**
 *
 * This is the API Keys section, it manages the machine to machine credentials which an
 * account holds within the environment the caller is currently operating within.
 */
@ApiBearerAuth('bearer')
@Controller('keys')
@ApiTags('Keys')
export class KeysController {
    constructor(private readonly keysService: KeysService) {}

    /**
     * Every API Key which the account holds within the environment the caller is
     * currently operating within.
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    findAll(@Req() request: AuthorizedRequest) {
        return this.keysService.findAll({
            businessID: request?.user?.businessID,
            subject: request?.user?.sub,
        });
    }

    /**
     * Rotate the secret of a single API Key held by the account, every other key of the
     * account is left untouched.
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    @ApiOkResponse({ status: 200, type: BasicResponseDTO })
    rotate(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        return this.keysService.rotateSecret({
            businessID: request?.user?.businessID,
            subject: request?.user?.sub,
            keyId,
        });
    }

    /**
     * Retire a single API Key held by the account. The credential is withdrawn at the
     * identity provider and the account it signs in as is removed from the tenants
     * configuration, so a caller presenting it is refused from that moment onwards.
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    @ApiOkResponse({ status: 200, type: BasicResponseDTO })
    delete(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        return this.keysService.remove({
            businessID: request?.user?.businessID,
            subject: request?.user?.sub,
            keyId,
        });
    }
}
