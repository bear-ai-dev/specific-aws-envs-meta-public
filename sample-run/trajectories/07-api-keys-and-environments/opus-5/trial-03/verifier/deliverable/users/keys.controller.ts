import { Controller, Delete, Get, Logger, Param, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { PermissionsGuard } from '../authz/PermissionsGaurd.js';
import { AuthorizedRequest } from '../authz/jwt-local.gaurd.js';
import { UserPermissions } from './user.permissions.js';
import { KeysService } from './keys.service.js';
import { DeleteKeyResponseDTO, ReadKeysResponseDTO, RotateKeyResponseDTO } from './dto/read-key.dto.js';
import { Environment } from './dto/Environment.js';

/**
 * A request may name the environment it is for, exactly as it may for every
 * other resource of the platform. Anything else, and that is the usual case,
 * follows the environment the caller is currently in.
 */
const namedEnvironment = (request: AuthorizedRequest): Environment => {
    const chosen = request?.headers?.environment as Environment;
    return chosen && Object.values(Environment).includes(chosen) ? chosen : undefined;
};

/**
 *
 * This is the API keys section.
 *
 * Every route here works on the account of the environment the caller is
 * currently in. Listing is a read, while rotating a secret and retiring a key
 * are administrative acts.
 */
@ApiBearerAuth('bearer')
@ApiTags('Keys')
@Controller('keys')
export class KeysController {
    private static readonly logger = new Logger(KeysController.name);
    constructor(private readonly keysService: KeysService) {}

    /**
     * List the machine credentials your account holds in the environment you are
     * currently in
     */
    @ApiOkResponse({ status: 200, description: 'Keys found', type: ReadKeysResponseDTO })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSREAD]))
    @UseGuards(AuthGuard('jwt'))
    @Get()
    @ApiOperation({ operationId: 'Find all keys in the account' })
    findAll(@Req() request: AuthorizedRequest) {
        const { businessID, sub } = request?.user ?? ({} as AuthorizedRequest['user']);
        KeysController.logger.debug(`Listing keys for account: ${businessID}`);
        return this.keysService.findAll({ businessID, subject: sub, environment: namedEnvironment(request) });
    }

    /**
     * Replace the secret of one of your keys, leaving every other key untouched
     */
    @ApiOkResponse({ status: 200, description: 'Secret rotated', type: RotateKeyResponseDTO })
    @ApiNotFoundResponse({ status: 404, description: 'Key not found for the account' })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSUPDATE]))
    @UseGuards(AuthGuard('jwt'))
    @Put(':keyId')
    @ApiOperation({ operationId: 'Rotate a secret for a key' })
    rotate(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        const { businessID, sub } = request?.user ?? ({} as AuthorizedRequest['user']);
        KeysController.logger.debug(`Rotating key: ${keyId} for account: ${businessID}`);
        return this.keysService.rotate({
            businessID,
            subject: sub,
            keyId,
            environment: namedEnvironment(request),
        });
    }

    /**
     * Retire one of your keys for good
     */
    @ApiOkResponse({ status: 200, description: 'Key deleted', type: DeleteKeyResponseDTO })
    @ApiNotFoundResponse({ status: 404, description: 'Key not found for the account' })
    @UseGuards(PermissionsGuard([UserPermissions.KEYSDELETE]))
    @UseGuards(AuthGuard('jwt'))
    @Delete(':keyId')
    @ApiOperation({ operationId: 'Delete a user key' })
    delete(@Param('keyId') keyId: string, @Req() request: AuthorizedRequest) {
        const { businessID, sub } = request?.user ?? ({} as AuthorizedRequest['user']);
        KeysController.logger.debug(`Deleting key: ${keyId} for account: ${businessID}`);
        return this.keysService.remove({
            businessID,
            subject: sub,
            keyId,
            environment: namedEnvironment(request),
        });
    }
}
