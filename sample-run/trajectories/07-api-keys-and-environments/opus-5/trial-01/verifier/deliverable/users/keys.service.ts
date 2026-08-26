import { forwardRef, Inject, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { cache as cacheManager } from '../cacheStore.js';
import { InfluxService } from '../influx/influx.service.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { UsersService } from './users.service.js';

const SOFT_DELETED = 'deleted';

/**
 * The keys of an account, in the environment of the request.
 */
export type ReadKeysResponse = BasicResponseDTO & { data: KeyEntity[]; keys: KeyEntity[] };

/**
 * A rotated key, carrying the fresh secret which is only ever handed back once.
 */
export type RotateKeyResponse = BasicResponseDTO & KeyEntity & { data: KeyEntity[] };

/**
 * The keys of an account, in the environment the caller is currently in.
 *
 * A key is two things kept in step: the credential at the identity provider, and the account
 * configuration which says the account, and the environment of that account, it belongs to. A key of
 * another account, of the other environment of this account, of an integration which has already been
 * retired, or one the identity provider happens to hold but this account never claimed, is not a key
 * of this account and cannot be touched through here.
 */
@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        readonly usersService: UsersService,
    ) {}

    /**
     * Every key the account holds in the environment the caller is in.
     */
    async findAll({ subject, businessID }: { subject?: string; businessID?: string }): Promise<ReadKeysResponse> {
        const account = await this.resolveBusinessID({ subject, businessID });
        const keys = await this.findKeysForAccount(account);
        return { message: 'Found keys', data: keys, keys };
    }

    /**
     * Replaces the secret of one key of the account, every other key is left exactly as it was.
     */
    async rotate({
        subject,
        businessID,
        keyId,
    }: {
        subject?: string;
        businessID?: string;
        keyId: string;
    }): Promise<RotateKeyResponse> {
        const account = await this.resolveBusinessID({ subject, businessID });
        const key = await this.findOneForAccount(account, keyId);
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const rotated = await KeyEntity.rotateSecret(key.keyId, access_token);
        KeysService.logger.log(`Rotated the secret of key: ${key.keyId} for account: ${account}`);
        const entity = new KeyEntity({
            keyId: key.keyId,
            name: rotated?.name ? rotated.name : key.name,
            subject: key.subject,
            businessID: account,
            environment: key.environment,
            clientSecret: rotated?.client_secret,
        });
        // The fresh secret is handed back here and nowhere else, it is never readable again.
        return {
            message: `Key: ${key.keyId} secret was rotated successfully`,
            ...entity,
            data: [entity],
        };
    }

    /**
     * Retires a key for good.
     *
     * The credential is withdrawn at the identity provider and the account it signs in as is taken out
     * of the configuration of the tenant, so a caller still presenting it is refused from that moment.
     */
    async remove({
        subject,
        businessID,
        keyId,
    }: {
        subject?: string;
        businessID?: string;
        keyId: string;
    }): Promise<BasicResponseDTO> {
        const account = await this.resolveBusinessID({ subject, businessID });
        const key = await this.findOneForAccount(account, keyId);
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        // Withdraw the credential itself first, no token can be minted with it from here on.
        await KeyEntity.deleteClient(key.keyId, access_token);
        // Then take the account the credential signs in as out of the configuration of the tenant.
        const { loadPoints } = this.InfluxService;
        const userEntity = new UserEntity({
            subject: key.subject,
            businessID: account,
            environment: key.environment,
            softDelete: SOFT_DELETED,
        });
        const pointsArray = UserEntity.transformer(userEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, pointsArray);
        // The configuration of the retired account is cached, it has to go now rather than at the end
        // of its lifetime, otherwise a caller still presenting the key would be served from the cache.
        await cacheManager.del(key.subject);
        KeysService.logger.log(`Deleted key: ${key.keyId} for account: ${account}`);
        return { message: `Key: ${key.keyId} was deleted successfully` };
    }

    /**
     * The account a request resolves to follows the environment the caller is currently in, which is
     * what the business ID on the request carries.
     */
    private async resolveBusinessID({
        subject,
        businessID,
    }: {
        subject?: string;
        businessID?: string;
    }): Promise<string> {
        if (businessID) {
            return businessID;
        }
        if (!subject) {
            throw new UnauthorizedException();
        }
        const {
            data: [user],
        } = await this.usersService.findOne({ subject });
        if (!user?.businessID) {
            throw new UnauthorizedException();
        }
        return user.businessID;
    }

    private async findKeysForAccount(businessID: string): Promise<KeyEntity[]> {
        const { data } = await this.usersService.findAllUsersForBusinessID({ businessID });
        const keyAccounts = data?.filter((user) => KeyEntity.isKeySubject(user?.subject));
        if (!keyAccounts?.length) {
            return [];
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const clients = await KeyEntity.listClients(access_token);
        return keyAccounts
            .map((user) => {
                const keyId = KeyEntity.subjectToClientId(user.subject);
                const client = clients.get(keyId);
                if (!client) {
                    KeysService.logger.warn(
                        `Key: ${keyId} of account: ${businessID} is not held by the identity provider`,
                    );
                    return undefined;
                }
                return new KeyEntity({
                    keyId,
                    name: client?.name,
                    subject: user.subject,
                    businessID,
                    environment: user.environment,
                });
            })
            .filter((key) => Boolean(key));
    }

    private async findOneForAccount(businessID: string, keyId: string): Promise<KeyEntity> {
        const keys = await this.findKeysForAccount(businessID);
        const key = keys.find((candidate) => candidate.keyId === keyId);
        if (!key) {
            KeysService.logger.warn(`Key: ${keyId} was not found for account: ${businessID}`);
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        return key;
    }
}
