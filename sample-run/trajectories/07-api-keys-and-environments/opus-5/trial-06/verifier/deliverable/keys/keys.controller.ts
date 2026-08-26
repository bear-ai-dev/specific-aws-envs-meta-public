import { Controller, Delete, Get, Headers, Logger, Param, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { UserPermissions } from '../users/user.permissions.js';
import { DeleteKeyResponseDto, ReadKeysResponseDto, RotateKeyResponseDto } from './dto/read-key.dto.js';
import { KeysService } from './keys.service.js';

/**
 *
 * This is the API keys section of the console. Every route works against the
 * account the caller resolves to in the environment they are currently in.
 */
@ApiBearerAuth('bearer')
@ApiTags('Keys')
@Controller('keys')
export class KeysController {
    private static readonly logger = new Logger(KeysController.name);
    constructor(private readonly keysService: KeysService) {}

    /**
     * List the keys the account holds in the current environment
     */
    @ApiOkResponse({ status: 200, description: 'Keys found', type: ReadKeysResponseDto })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    findAll(@Req() request: AuthorizedRequest, @Headers('environment') environment?: string) {
        return this.keysService.findAll({ subject: request?.user?.sub, environment });
    }

    /**
     * Rotate the secret of one key the account holds in the current environment
     */
    @ApiOkResponse({ status: 200, description: 'Key secret rotated', type: RotateKeyResponseDto })
    @ApiNotFoundResponse({ status: 404, description: 'Key not found for this account' })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    rotate(
        @Param('keyId') keyId: string,
        @Req() request: AuthorizedRequest,
        @Headers('environment') environment?: string,
    ) {
        return this.keysService.rotate({ keyId, subject: request?.user?.sub, environment });
    }

    /**
     * Retire one key the account holds in the current environment
     */
    @ApiOkResponse({ status: 200, description: 'Key deleted', type: DeleteKeyResponseDto })
    @ApiNotFoundResponse({ status: 404, description: 'Key not found for this account' })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    remove(
        @Param('keyId') keyId: string,
        @Req() request: AuthorizedRequest,
        @Headers('environment') environment?: string,
    ) {
        return this.keysService.remove({ keyId, subject: request?.user?.sub, environment });
    }
}
