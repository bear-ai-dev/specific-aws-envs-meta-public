import { Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { KeysService } from './keys.service.js';
import { UserPermissions } from './user.permissions.js';

/**
 *
 * This is the keys section.
 *
 * A key is a machine credential of an account. Keys belong to one environment of one account, so the
 * keys which are listed, and the keys which may be rotated or deleted, are those of the account the
 * request resolves to in the environment the caller is currently in. Listing a key is a read, while
 * rotating and deleting one are administrative acts.
 */
@ApiBearerAuth('bearer')
@Controller('keys')
@ApiTags('Keys')
export class KeysController {
    constructor(private readonly keysService: KeysService) {}

    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    findAll(@Req() request: AuthorizedRequest): Promise<object> {
        return this.keysService.findAll({
            subject: request?.user?.sub,
            businessID: request?.user?.businessID,
        });
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    remove(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest): Promise<BasicResponseDTO> {
        return this.keysService.remove({
            subject: request?.user?.sub,
            businessID: request?.user?.businessID,
            keyId,
        });
    }

    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    rotate(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest): Promise<BasicResponseDTO> {
        return this.keysService.rotate({
            subject: request?.user?.sub,
            businessID: request?.user?.businessID,
            keyId,
        });
    }
}
