import { forwardRef, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { cache as cacheManager } from '../cacheStore.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { EnvironmentService, UsersService } from './users.service.js';
import { ReadKeyDTO, ReadKeysResponseDTO } from './dto/read-key.dto.js';

/**
 * The machine credentials of a single environment of a single account.
 *
 * Two systems hold a part of a key. The identity provider holds the credential itself, the id and
 * the secret which are exchanged for a token, and the configuration store holds the row which ties
 * the subject that credential signs in as to one account inside one environment. A key is only ever
 * a key of the account which claims it: every operation below resolves the account of the caller
 * first and refuses anything which that account does not hold, leaving it exactly as it was.
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
     * List the machine credentials which the callers account holds inside of the environment the
     * caller is currently in. Secrets are never listed, only rotation hands one back.
     */
    async findAll({ subject, businessID }: { subject: string; businessID?: string }): Promise<ReadKeysResponseDTO> {
        const account = await this.resolveAccount({ subject, businessID });
        const claimed = await this.claimedKeys(account, subject);
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);

        const keys = await Promise.all(
            claimed.map(async (key) => {
                const client = await KeyEntity.findClient(key.keyId, access_token);
                if (!client) {
                    // The account claims a credential the identity provider no longer holds.
                    KeysService.logger.warn(
                        `Key: ${key.keyId} claimed by: ${account} is not held by the identity provider`,
                    );
                    return undefined;
                }
                key.name = client?.name;
                key.appType = client?.app_type;
                return key;
            }),
        );

        const data = keys.filter((key) => Boolean(key)).map((key) => key.toResponse() as ReadKeyDTO);
        return {
            message: 'Found keys',
            data,
        };
    }

    /**
     * Replace the secret of one credential of the callers account. The credential keeps its id, and
     * every other credential, of this account or any other, is left untouched.
     */
    async rotate({
        subject,
        businessID,
        keyId,
    }: {
        subject: string;
        businessID?: string;
        keyId: string;
    }): Promise<BasicResponseDTO> {
        const account = await this.resolveAccount({ subject, businessID });
        const key = await this.findKeyInAccount({ account, keyId, subject });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const client = await KeyEntity.findClient(keyId, access_token);
        if (!client) {
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        const rotated = await KeyEntity.rotateSecret(keyId, access_token);
        key.name = rotated?.name ? rotated.name : client?.name;
        key.appType = rotated?.app_type ? rotated.app_type : client?.app_type;
        key.clientSecret = rotated?.client_secret;
        KeysService.logger.log(`Rotated the secret of key: ${keyId} for account: ${account}`);

        const response = key.toResponse();
        return {
            message: `Rotated the secret for key: ${keyId}`,
            data: [response],
            ...response,
        } as BasicResponseDTO;
    }

    /**
     * Retire one credential of the callers account for good. The credential is withdrawn at the
     * identity provider and the subject it signs in as is taken out of the accounts configuration,
     * so a caller still presenting it is refused from this moment onwards.
     */
    async remove({
        subject,
        businessID,
        keyId,
    }: {
        subject: string;
        businessID?: string;
        keyId: string;
    }): Promise<BasicResponseDTO> {
        const account = await this.resolveAccount({ subject, businessID });
        const key = await this.findKeyInAccount({ account, keyId, subject });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);

        await KeyEntity.deleteClient(keyId, access_token);
        await this.usersService.softDelete({
            subject: key.subject,
            businessID: key.businessID ? key.businessID : account,
            environment: key.environment,
        });
        KeysService.logger.log(`Deleted key: ${keyId} of account: ${account}`);

        return { message: `Deleted key: ${keyId}` };
    }

    /**
     * The account the request resolves to, which follows the environment the caller is in.
     */
    private async resolveAccount({ subject, businessID }: { subject: string; businessID?: string }): Promise<string> {
        if (businessID) {
            return businessID;
        }
        if (!subject) {
            throw new UnauthorizedException();
        }
        const { data } = await this.usersService.findOne({ subject });
        const [user] = data ? data : [];
        if (!user?.businessID) {
            throw new NotFoundException(`Business ID was not found for subject: ${subject}`);
        }
        return user.businessID;
    }

    /**
     * Every machine credential which the given account currently claims. Credentials which were
     * retired, and credentials of any other account or environment, are simply not in here.
     */
    private async claimedKeys(account: string, subject?: string): Promise<KeyEntity[]> {
        const { readAllUsersForBusiness } = this.InfluxService;
        const results = await readAllUsersForBusiness(account);
        let keys = results
            .filter((result) => KeyEntity.isMachineCredentialSubject(result?.subject))
            .map(
                (result) =>
                    new KeyEntity({
                        keyId: KeyEntity.keyIdForSubject(result.subject),
                        subject: result.subject,
                        businessID: result.businessID ? result.businessID : account,
                        environment: result.environment,
                    }),
            );

        // An account belongs to one environment, so ordinarily there is nothing left to narrow.
        // Should an account nonetheless hold credentials in both, the environment the caller is
        // currently in decides which of them the request may see.
        const environments = new Set(keys.map((key) => key.environment).filter((environment) => environment));
        if (environments.size > 1 && subject) {
            const { environment } = await this.environmentService.getCurrentEnvironment(subject);
            const narrowed = keys.filter((key) => key.environment === environment);
            if (narrowed.length) {
                keys = narrowed;
            }
        }

        return keys.sort((first, second) => first.keyId.localeCompare(second.keyId));
    }

    private async findKeyInAccount({
        account,
        keyId,
        subject,
    }: {
        account: string;
        keyId: string;
        subject?: string;
    }): Promise<KeyEntity> {
        if (!keyId) {
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        const claimed = await this.claimedKeys(account, subject);
        const key = claimed.find((candidate) => candidate.keyId === keyId);
        if (!key) {
            // Another account, the other environment of this account, an already retired
            // integration, or something the identity provider holds which was never claimed.
            KeysService.logger.warn(`Key: ${keyId} is not held by account: ${account}`);
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        return key;
    }
}
