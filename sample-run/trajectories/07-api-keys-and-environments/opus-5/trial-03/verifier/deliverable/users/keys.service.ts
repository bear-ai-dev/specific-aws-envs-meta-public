import { forwardRef, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { cache as cacheManager } from '../cacheStore.js';
import { Environment } from './dto/Environment.js';
import { DeleteKeyResponseDTO, ReadKeysResponseDTO, RotateKeyResponseDTO } from './dto/read-key.dto.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { EnvironmentService, UsersService } from './users.service.js';

/**
 * The API keys of an account.
 *
 * A key is a machine credential: the identity provider holds the client id and
 * its secret, and the platform's configuration store records which account, in
 * which environment, that credential signs in as. Both halves matter here.
 *
 * Every operation is scoped to the account the request resolved to, which is the
 * account of the environment the caller is currently in. A key which that
 * account does not hold is refused, and refused before the identity provider is
 * touched at all, so a refused request leaves the credential exactly as it was.
 * That covers a key of another tenant, a key of this tenant's other
 * environment, a key of an integration which has already been retired, and a
 * client the identity provider knows about which the tenant never claimed.
 */
@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        readonly usersService: UsersService,
        readonly environmentService: EnvironmentService,
    ) {}

    /**
     * Lists the machine credentials the account holds in the environment the
     * caller is currently in.
     */
    async findAll({
        businessID,
        subject,
        environment: chosenEnvironment,
    }: {
        businessID: string;
        subject?: string;
        environment?: Environment;
    }): Promise<ReadKeysResponseDTO> {
        const { environment, keys } = await this.getAccountKeys({
            businessID,
            subject,
            environment: chosenEnvironment,
        });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);

        const data = await Promise.all(
            keys.map(async (key) => {
                let client = null;
                try {
                    client = await KeyEntity.findClient(key.keyId, access_token);
                } catch (e) {
                    KeysService.logger.warn(`Could not read client ${key.keyId} from the identity provider`);
                }
                return {
                    ...(client ? client : {}),
                    client_id: key.keyId,
                    clientId: key.keyId,
                    keyId: key.keyId,
                    name: client && client.name ? client.name : key.name,
                    subject: key.subject,
                    businessID: key.businessID,
                    environment: key.environment ? key.environment : environment,
                };
            }),
        );

        return { message: 'Found keys', data };
    }

    /**
     * Replaces the secret of a single credential the account holds. The client
     * id survives, every other credential is left untouched, and the new secret
     * is returned because it is only readable at the moment it is created.
     */
    async rotate({
        businessID,
        subject,
        keyId,
        environment,
    }: {
        businessID: string;
        subject?: string;
        keyId: string;
        environment?: Environment;
    }): Promise<RotateKeyResponseDTO> {
        const key = await this.findOwnedKey({ businessID, subject, keyId, environment });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const rotated = await KeyEntity.rotateSecret(key.keyId, access_token);
        const clientSecret = rotated?.client_secret;
        const name = rotated?.name ? rotated.name : key.name;

        KeysService.logger.log(`Rotated the secret for key: ${key.keyId} of account: ${businessID}`);

        return {
            message: `Successfully rotated the secret for key: ${key.keyId}`,
            client_id: key.keyId,
            clientId: key.keyId,
            keyId: key.keyId,
            client_secret: clientSecret,
            clientSecret,
            secret: clientSecret,
            name,
            data: [
                {
                    ...rotated,
                    client_id: key.keyId,
                    clientId: key.keyId,
                    keyId: key.keyId,
                    client_secret: clientSecret,
                    clientSecret,
                    name,
                    businessID: key.businessID,
                    environment: key.environment,
                },
            ],
        };
    }

    /**
     * Retires a credential for good: it is withdrawn at the identity provider
     * and the account it signs in as is taken out of the tenant's
     * configuration, so a caller still presenting it is refused from this
     * moment onwards.
     */
    async remove({
        businessID,
        subject,
        keyId,
        environment,
    }: {
        businessID: string;
        subject?: string;
        keyId: string;
        environment?: Environment;
    }): Promise<DeleteKeyResponseDTO> {
        const key = await this.findOwnedKey({ businessID, subject, keyId, environment });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        await KeyEntity.deleteClient(key.keyId, access_token);
        await this.usersService.softDelete({
            subject: key.subject,
            businessID: key.businessID,
            environment: key.environment,
        });

        KeysService.logger.log(`Retired key: ${key.keyId} of account: ${businessID}`);

        return {
            message: `Successfully deleted key: ${key.keyId}`,
            client_id: key.keyId,
            clientId: key.keyId,
            keyId: key.keyId,
        };
    }

    /**
     * The single place which decides whether a key belongs to the account the
     * request resolved to. Called before anything is changed anywhere.
     */
    private async findOwnedKey({
        businessID,
        subject,
        keyId,
        environment,
    }: {
        businessID: string;
        subject?: string;
        keyId: string;
        environment?: Environment;
    }): Promise<KeyEntity> {
        const requestedClientId = KeyEntity.subjectToClientId(keyId);
        const { keys } = await this.getAccountKeys({ businessID, subject, environment });
        const key = keys.find((candidate) => candidate.keyId === requestedClientId);
        if (!key) {
            KeysService.logger.warn(`Key: ${keyId} is not held by account: ${businessID}`);
            throw new NotFoundException(`Key: ${keyId} was not found for account: ${businessID}`);
        }
        return key;
    }

    /**
     * Reads the credentials of the account out of the configuration store.
     *
     * Only the subjects of machine credentials are keys, a person who signs in
     * to the console is not one, and a retired credential is no longer part of
     * the configuration so it is not one either.
     */
    private async getAccountKeys({
        businessID,
        subject,
        environment: chosenEnvironment,
    }: {
        businessID: string;
        subject?: string;
        environment?: Environment;
    }): Promise<{ environment: Environment; keys: KeyEntity[] }> {
        if (!businessID) {
            KeysService.logger.warn(`No account resolved for subject: ${subject}`);
            throw new UnauthorizedException();
        }
        const environment = await this.getEnvironment({ businessID, subject, environment: chosenEnvironment });
        const { readAllUsersForBusiness } = this.InfluxService;
        const results = await readAllUsersForBusiness(businessID);

        const keys = results
            .filter((result) => KeyEntity.isMachineSubject(result?.subject))
            .filter((result) => !result?.environment || result?.environment === environment)
            .map(
                (result) =>
                    new KeyEntity({
                        keyId: KeyEntity.subjectToClientId(result.subject),
                        businessID: result.businessID ? result.businessID : businessID,
                        environment: result.environment ? result.environment : environment,
                    }),
            )
            .sort((left, right) => left.keyId.localeCompare(right.keyId));

        return { environment, keys };
    }

    /**
     * The environment the request is in.
     *
     * It is resolved exactly as the account itself was resolved: an environment
     * named on the request wins, otherwise it is the environment the caller is
     * currently in. Only if the caller cannot be resolved at all does the
     * account's own configuration decide.
     */
    private async getEnvironment({
        businessID,
        subject,
        environment,
    }: {
        businessID: string;
        subject?: string;
        environment?: Environment;
    }): Promise<Environment> {
        if (environment && Object.values(Environment).includes(environment)) {
            return environment;
        }
        if (subject) {
            try {
                const {
                    data: [userEntity],
                } = await this.usersService.findOne({ subject });
                if (userEntity?.environment && userEntity?.businessID === businessID) {
                    return userEntity.environment;
                }
            } catch (e) {
                KeysService.logger.warn(`Could not resolve the account of subject: ${subject}`);
            }
            const { environment: currentEnvironment } = await this.environmentService.getCurrentEnvironment(subject);
            if (currentEnvironment) {
                return currentEnvironment;
            }
        }
        try {
            const { environment: accountEnvironment } =
                await this.environmentService.getEnvironmentForBusinessID(businessID);
            if (accountEnvironment) {
                return accountEnvironment;
            }
        } catch (e) {
            KeysService.logger.warn(`No environment recorded for account: ${businessID}`);
        }
        return Environment.PRODUCTION;
    }
}
