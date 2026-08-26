import { Controller, Delete, Get, Logger, Param, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { UserPermissions } from '../users/user.permissions.js';
import { ReadKeysResponseDto, RotateKeyResponseDto } from './dto/read-key.dto.js';
import { KeysService } from './keys.service.js';

/**
 *
 * This is the api keys section. It backs the API key screen of the console: the machine credentials
 * an account holds in the environment the caller is currently in can be listed, given a fresh
 * secret, or retired for good.
 */
@ApiBearerAuth('bearer')
@ApiTags('Keys')
@Controller('keys')
export class KeysController {
    private static logger = new Logger(KeysController.name);
    constructor(private readonly keysService: KeysService) {}

    /**
     * Find all of the machine credentials the account holds in the environment the caller is in
     */
    @ApiOkResponse({ status: 200, description: 'Keys found', type: ReadKeysResponseDto })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    async findAll(@Req() request: AuthorizedRequest): Promise<ReadKeysResponseDto> {
        return this.keysService.findAll({
            subject: request?.user?.sub,
            requestedEnvironment: request?.headers?.environment as string,
        });
    }

    /**
     * Replace the secret of a single credential of the account. Every other credential is left
     * exactly as it was.
     */
    @ApiOkResponse({ status: 200, description: 'Secret rotated', type: RotateKeyResponseDto })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    async rotate(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest): Promise<RotateKeyResponseDto> {
        KeysController.logger.log(`Rotating the secret of key: ${keyId}`);
        return this.keysService.rotate({
            subject: request?.user?.sub,
            keyId,
            requestedEnvironment: request?.headers?.environment as string,
        });
    }

    /**
     * Retire a credential of the account for good
     */
    @ApiOkResponse({ status: 200, description: 'Key deleted', type: BasicResponseDTO })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    async remove(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest): Promise<BasicResponseDTO> {
        KeysController.logger.log(`Deleting key: ${keyId}`);
        return this.keysService.remove({
            subject: request?.user?.sub,
            keyId,
            requestedEnvironment: request?.headers?.environment as string,
        });
    }
}
