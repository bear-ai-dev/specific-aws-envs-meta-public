import { forwardRef, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { InfluxService } from '../influx/influx.service.js';
import { Environment } from './dto/Environment.js';
import { ReadKeyDTO, ReadKeysResponseDTO } from './dto/read-keys.dto.js';
import { KeyEntity } from './entities/keys.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

/**
 * The machine credentials (API keys) of an account.
 *
 * A key belongs to exactly one environment of exactly one account: the account of the
 * request is resolved from the environment the caller is currently in, so the keys of the
 * sandbox are invisible from production and the other way around. Any key which the
 * current account does not hold is refused, and left exactly as it was.
 */
@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        readonly usersService: UsersService,
    ) {}

    /**
     * Every machine credential the account claims, straight from the platform configuration.
     */
    private async getClaimedKeys(businessID: string): Promise<Array<KeyEntity>> {
        const { readAllUsersForBusiness } = this.InfluxService;
        const results = await readAllUsersForBusiness(businessID);
        return results
            .map((result) => UserEntity.dbModelToEntity([result]))
            .map((entity) => ({ entity, clientId: KeyEntity.clientIdForSubject(entity?.subject) }))
            .filter(({ clientId }) => Boolean(clientId))
            .map(
                ({ entity, clientId }) =>
                    new KeyEntity({
                        clientId,
                        subject: entity.subject,
                        businessID: entity.businessID,
                        environment: entity.environment,
                    }),
            );
    }

    private assertAccount(businessID: string): void {
        if (!businessID) {
            KeysService.logger.warn(`No account was resolved for the request, refusing the key operation`);
            throw new UnauthorizedException();
        }
    }

    /**
     * Finds the key inside of the current account, refusing anything the account does not
     * hold, be it another account's key, the other environment's key, a key which has
     * already been retired, or something the identity provider knows about which this
     * account never claimed.
     */
    private async findOwnedKey(businessID: string, keyId: string): Promise<KeyEntity> {
        this.assertAccount(businessID);
        const clientId = KeyEntity.normalizeKeyId(keyId);
        const claimed = await this.getClaimedKeys(businessID);
        const key = claimed.find((candidate) => candidate.clientId === clientId);
        if (!key) {
            KeysService.logger.warn(`Key: ${clientId} is not held by account: ${businessID}`);
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        return key;
    }

    /**
     * Lists the machine credentials the account holds in the environment of the request
     */
    async findAll({ businessID }: { businessID: string }): Promise<ReadKeysResponseDTO> {
        this.assertAccount(businessID);
        const claimed = await this.getClaimedKeys(businessID);
        let data: Array<ReadKeyDTO> = [];
        if (claimed.length) {
            const accessToken = await KeyEntity.getManagementToken();
            const clients = await KeyEntity.listClients(accessToken);
            const clientsById = new Map(clients.map((client) => [client.client_id, client]));
            data = claimed
                // A credential the identity provider no longer holds is no longer a key
                .filter((key) => clientsById.has(key.clientId))
                .map((key) => {
                    key.name = clientsById.get(key.clientId)?.name;
                    return key.toResponse();
                });
        }
        return {
            message: `Found ${data.length} keys`,
            data,
            keys: data,
            total: data.length,
        };
    }

    /**
     * Replaces the secret of a single key, leaving every other key untouched
     */
    async rotate({ businessID, keyId }: { businessID: string; keyId: string }): Promise<BasicResponseDTO> {
        const key = await this.findOwnedKey(businessID, keyId);
        const accessToken = await KeyEntity.getManagementToken();
        const client = await KeyEntity.findClient(key.clientId, accessToken);
        if (!client) {
            KeysService.logger.warn(`Key: ${key.clientId} is not held by the identity provider`);
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        const rotated = await KeyEntity.rotateSecret(key.clientId, accessToken);
        key.name = rotated?.name ?? client?.name;
        key.clientSecret = rotated?.client_secret;
        KeysService.logger.log(`Rotated the secret for key: ${key.clientId} of account: ${businessID}`);
        const data = {
            ...key.toResponse(),
            secret: key.clientSecret,
            clientSecret: key.clientSecret,
            client_secret: key.clientSecret,
        };
        return {
            message: `Successfully rotated the secret for key: ${key.clientId}`,
            keyId: key.clientId,
            clientId: key.clientId,
            client_id: key.clientId,
            name: key.name,
            clientName: key.name,
            secret: key.clientSecret,
            clientSecret: key.clientSecret,
            client_secret: key.clientSecret,
            key: data,
            data: [data],
        } as BasicResponseDTO;
    }

    /**
     * Retires a key for good: the credential is withdrawn at the identity provider and the
     * account it signs in as is taken out of the account configuration, so a caller still
     * presenting it is refused from that moment onwards.
     */
    async remove({ businessID, keyId }: { businessID: string; keyId: string }): Promise<BasicResponseDTO> {
        const key = await this.findOwnedKey(businessID, keyId);
        const accessToken = await KeyEntity.getManagementToken();
        const client = await KeyEntity.findClient(key.clientId, accessToken);
        if (!client) {
            KeysService.logger.warn(`Key: ${key.clientId} is not held by the identity provider`);
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        // The credential goes first: if the identity provider refuses, nothing has changed.
        await KeyEntity.deleteClient(key.clientId, accessToken);
        await this.usersService.revoke({
            subject: key.subject,
            businessID: key.businessID ?? businessID,
            environment: key.environment as Environment,
        });
        KeysService.logger.log(`Deleted key: ${key.clientId} of account: ${businessID}`);
        return {
            message: `Successfully deleted key: ${key.clientId}`,
            keyId: key.clientId,
            clientId: key.clientId,
            client_id: key.clientId,
        } as BasicResponseDTO;
    }
}
