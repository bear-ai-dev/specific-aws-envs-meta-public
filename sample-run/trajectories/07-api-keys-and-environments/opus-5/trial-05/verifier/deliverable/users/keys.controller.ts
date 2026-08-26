import { Controller, Delete, Get, Logger, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { UserPermissions } from './user.permissions.js';
import { KeysService } from './keys.service.js';

/**
 *
 * This is the api keys section.
 *
 * A key is a machine credential of a single environment of a single account. Which keys a request
 * can see, rotate or retire follows the account the request resolves to, which in turn follows the
 * environment the caller is currently in.
 */
@ApiTags('Keys')
@ApiBearerAuth('bearer')
@Controller('keys')
export class KeysController {
    private static readonly logger = new Logger(KeysController.name);
    constructor(private readonly keysService: KeysService) {}

    /**
     * List the api keys which your account holds in the environment you are currently in
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    findAll(@Req() request: AuthorizedRequest) {
        return this.keysService.findAll({
            subject: request?.user?.sub,
            businessID: request?.user?.businessID,
        });
    }

    /**
     * Retire one of your api keys for good
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    remove(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        KeysController.logger.log(`Deleting key: ${keyId}`);
        return this.keysService.remove({
            subject: request?.user?.sub,
            businessID: request?.user?.businessID,
            keyId,
        });
    }

    /**
     * Rotate the secret of one of your api keys, every other key is left untouched
     */
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    rotate(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        KeysController.logger.log(`Rotating the secret for key: ${keyId}`);
        return this.keysService.rotate({
            subject: request?.user?.sub,
            businessID: request?.user?.businessID,
            keyId,
        });
    }
}
