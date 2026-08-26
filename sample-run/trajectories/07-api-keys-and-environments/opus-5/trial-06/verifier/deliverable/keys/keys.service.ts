import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { cache as cacheManager } from '../cacheStore.js';
import { InfluxService } from '../influx/influx.service.js';
import { Environment } from '../users/dto/Environment.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { EnvironmentService, UsersService } from '../users/users.service.js';
import { DeleteKeyResponseDto, KeyDto, ReadKeysResponseDto, RotateKeyResponseDto } from './dto/read-key.dto.js';
import { KeyEntity } from './entities/key.entity.js';

/**
 * The account a request works against: a tenant and the one environment of it
 * the caller is currently in.
 */
export type ResolvedAccount = {
    businessID: string;
    environment: Environment;
};

/**
 * The API key screen of the console.
 *
 * A key is a machine credential at the identity provider that the tenant holds
 * in exactly one environment. The credential lives at the identity provider,
 * the claim on it lives in the configuration store under the account the
 * credential signs in as, and both halves have to agree before anything is
 * listed, rotated or retired. Every operation is scoped to the account the
 * caller resolves to in the environment they are currently in, so a key held
 * in the sandbox is invisible from production and vice versa.
 */
@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        readonly environmentService: EnvironmentService,
    ) {}

    /**
     * Which account does this request work against?
     *
     * The environment the caller is currently in decides, and it is read fresh
     * on every request, so moving between environments takes effect on the very
     * next request rather than at the next sign in.
     */
    async resolveAccount({
        subject,
        environment,
    }: {
        subject: string;
        environment?: string;
    }): Promise<ResolvedAccount> {
        if (!subject) {
            throw new NotFoundException(`No account was found for the request`);
        }
        let chosenEnvironment = environment as Environment;
        if (!chosenEnvironment) {
            const current = await this.environmentService.getCurrentEnvironment(subject);
            chosenEnvironment = current?.environment;
        }
        if (!Object.values(Environment).includes(chosenEnvironment)) {
            throw new BadRequestException(`Invalid Environment chosen: ${chosenEnvironment}`);
        }
        let accounts: UserEntity[];
        try {
            accounts = await this.environmentService.getEnvironmentsForUser(subject);
        } catch (error) {
            KeysService.logger.warn(`No accounts found for subject: ${subject}`);
            throw new NotFoundException(`No account was found for subject: ${subject}`);
        }
        const account = accounts.find(
            ({ environment: accountEnvironment }) => accountEnvironment === chosenEnvironment,
        );
        if (!account?.businessID) {
            throw new NotFoundException(`No ${chosenEnvironment} account was found for subject: ${subject}`);
        }
        return { businessID: account.businessID, environment: chosenEnvironment };
    }

    /**
     * The keys the account holds in the environment the caller is in.
     *
     * A configuration row is only reported as a key when the identity provider
     * still holds the credential, so a retired integration disappears from the
     * screen and a credential the tenant never claimed never appears on it.
     */
    async findAll({ subject, environment }: { subject: string; environment?: string }): Promise<ReadKeysResponseDto> {
        const account = await this.resolveAccount({ subject, environment });
        const entities = await this.readKeysForAccount(account);
        return new ReadKeysResponseDto({
            message: 'Found keys',
            data: entities.map((entity) => KeyDto.fromEntity(entity)),
        });
    }

    /**
     * Replace the secret on one key of the account, leaving every other key
     * exactly as it was.
     */
    async rotate({
        keyId,
        subject,
        environment,
    }: {
        keyId: string;
        subject: string;
        environment?: string;
    }): Promise<RotateKeyResponseDto> {
        const account = await this.resolveAccount({ subject, environment });
        const { entity, access_token } = await this.findKeyForAccount({ keyId, account });

        const rotated = await KeyEntity.rotateSecret(entity.keyId, access_token);
        entity.clientSecret = rotated?.client_secret;
        KeysService.logger.log(`Rotated the secret for key: ${entity.keyId} of account: ${account.businessID}`);

        return new RotateKeyResponseDto({ message: 'Key secret was rotated successfully', entity });
    }

    /**
     * Retire one key of the account for good.
     *
     * The credential is withdrawn at the identity provider and the account it
     * signs in as is taken out of the tenant's configuration, so a caller still
     * presenting it is refused from the next request onwards.
     */
    async remove({
        keyId,
        subject,
        environment,
    }: {
        keyId: string;
        subject: string;
        environment?: string;
    }): Promise<DeleteKeyResponseDto> {
        const account = await this.resolveAccount({ subject, environment });
        const { entity, access_token } = await this.findKeyForAccount({ keyId, account });

        await KeyEntity.deleteClient(entity.keyId, access_token);
        await this.revokeAccountForKey(entity);
        KeysService.logger.log(`Retired key: ${entity.keyId} of account: ${account.businessID}`);

        return new DeleteKeyResponseDto({ message: 'Key was deleted successfully', keyId: entity.keyId });
    }

    /**
     * The subjects of the machine credentials the account claims, straight from
     * the configuration store. Retired claims are already excluded by the read.
     */
    private async readClaimedSubjects({ businessID, environment }: ResolvedAccount): Promise<string[]> {
        const rows = await this.influxService.readAllUsersForBusiness(businessID);
        const subjects = new Set<string>();
        (rows || []).forEach((row) => {
            const rowSubject = row?.subject;
            if (!KeyEntity.isMachineSubject(rowSubject)) {
                // A person who signs in to the console is not a key
                return;
            }
            if (row?.environment && row.environment !== environment) {
                return;
            }
            subjects.add(rowSubject);
        });
        return [...subjects];
    }

    private async readKeysForAccount(account: ResolvedAccount): Promise<KeyEntity[]> {
        const claimed = await this.readClaimedSubjects(account);
        if (!claimed.length) {
            return [];
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const clients = await KeyEntity.listClients(access_token);
        return claimed
            .map((claimedSubject) => KeyEntity.keyIdForSubject(claimedSubject))
            .filter((keyId) => clients.has(keyId))
            .sort((first, second) => first.localeCompare(second))
            .map(
                (keyId) =>
                    new KeyEntity({
                        keyId,
                        name: clients.get(keyId)?.name,
                        appType: clients.get(keyId)?.app_type,
                        businessID: account.businessID,
                        environment: account.environment,
                    }),
            );
    }

    /**
     * Find the key the request names, but only within the account the caller is
     * working in. A key belonging to another tenant, to this tenant's other
     * environment, to an integration already retired, or one the identity
     * provider knows about but the tenant never claimed, is not found here and
     * is therefore left exactly as it was.
     */
    private async findKeyForAccount({
        keyId,
        account,
    }: {
        keyId: string;
        account: ResolvedAccount;
    }): Promise<{ entity: KeyEntity; access_token: string }> {
        const requestedKeyId = KeyEntity.keyIdForSubject((keyId || '').trim());
        if (!requestedKeyId) {
            throw new BadRequestException(`A key id is required`);
        }
        const claimed = await this.readClaimedSubjects(account);
        if (!claimed.includes(KeyEntity.subjectForKeyId(requestedKeyId))) {
            KeysService.logger.warn(
                `Key: ${requestedKeyId} is not held by account: ${account.businessID} in ${account.environment}`,
            );
            throw new NotFoundException(`Key: ${requestedKeyId} was not found for this account`);
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const client = await KeyEntity.findClient(requestedKeyId, access_token);
        if (!client) {
            KeysService.logger.warn(`Key: ${requestedKeyId} is unknown to the identity provider`);
            throw new NotFoundException(`Key: ${requestedKeyId} was not found for this account`);
        }
        return {
            entity: new KeyEntity({
                keyId: requestedKeyId,
                name: client?.name,
                appType: client?.app_type,
                businessID: account.businessID,
                environment: account.environment,
            }),
            access_token,
        };
    }

    /**
     * Take the account a retired credential signs in as out of the tenant's
     * configuration, and forget anything remembered about it, so the very next
     * request made with the credential resolves to no account at all.
     */
    private async revokeAccountForKey(entity: KeyEntity): Promise<void> {
        const revoked = new UserEntity({
            subject: entity.subject,
            businessID: entity.businessID,
            environment: entity.environment,
            softDelete: 'deleted',
        });
        const points = UserEntity.transformer(revoked, this.influxService);
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        await UsersService.forgetUser(entity.subject);
    }
}
