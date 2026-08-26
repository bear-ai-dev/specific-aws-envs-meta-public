import { Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { UserTable } from '../influx/entities/userTable.entity.js';
import { cache as cacheManager } from '../cacheStore.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { Environment } from './dto/Environment.js';
import { ReadKeyResponseData, ReadKeysResponseDto, RotateKeyResponseDto } from './dto/read-key.dto.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { EnvironmentService, UsersService } from './users.service.js';

/**
 * The keys service manages the machine to machine credentials, (API Keys), which an
 * account holds.
 *
 * A credential belongs to exactly one environment of exactly one account, the account
 * is resolved from the caller of the request, which itself follows the environment the
 * caller is currently operating within. Therefore any credential which is not held by
 * the account of the caller is not visible, and cannot be altered in any way.
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
     * Every credential which the account holds within the environment of the caller.
     */
    async findAll({ businessID, subject }: { businessID: string; subject: string }): Promise<ReadKeysResponseDto> {
        const rows = await this.getKeyRowsForAccount({ businessID, subject });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        let clients = [];
        try {
            clients = await KeyEntity.listClients(access_token);
        } catch (e) {
            KeysService.logger.warn(`Unable to list the credentials held by the identity provider`);
        }
        const clientsByKeyId = new Map(clients.map((client) => [client?.client_id, client]));
        const data = rows
            .map((row) => {
                const entity = KeyEntity.dbModelToEntity(row);
                entity.name = clientsByKeyId.get(entity.keyId)?.name;
                return ReadKeyResponseData.fromEntity(entity);
            })
            // The TSDB returns the configuration rows in the order they were written,
            // the keys are listed in a stable order instead.
            .sort((first, second) => first.keyId.localeCompare(second.keyId));
        return { message: 'Found keys', data };
    }

    /**
     * Replaces the secret of a single credential held by the account, every other
     * credential the account holds is left untouched.
     */
    async rotateSecret({
        businessID,
        subject,
        keyId,
    }: {
        businessID: string;
        subject: string;
        keyId: string;
    }): Promise<RotateKeyResponseDto> {
        const entity = await this.findKeyForAccount({ businessID, subject, keyId });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const client = await KeyEntity.rotateClientSecret(entity.keyId, access_token);
        entity.name = client?.['name'] || entity.name;
        entity.clientSecret = client?.client_secret;
        const data = ReadKeyResponseData.fromEntity(entity);
        return {
            message: 'Rotated the secret for the key',
            data: [data],
            client_secret: entity.clientSecret,
            clientSecret: entity.clientSecret,
        };
    }

    /**
     * Retires a single credential held by the account. The credential is withdrawn at
     * the identity provider, and the account which it signs in as is removed from the
     * configuration of the tenant, so that a caller which still presents it is refused
     * from this moment onwards.
     */
    async remove({
        businessID,
        subject,
        keyId,
    }: {
        businessID: string;
        subject: string;
        keyId: string;
    }): Promise<BasicResponseDTO> {
        const entity = await this.findKeyForAccount({ businessID, subject, keyId });
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        await KeyEntity.deleteClient(entity.keyId, access_token);
        await this.softDeleteKeyConfiguration(entity);
        return { message: 'Deleted the key' };
    }

    /**
     * Removes the subject of the credential from the accounts configuration, and drops
     * any cached authorization of it so the next request made with the credential is
     * refused.
     */
    private async softDeleteKeyConfiguration(entity: KeyEntity): Promise<void> {
        const { loadPoints } = this.InfluxService;
        const userEntity = new UserEntity({
            subject: entity.subject,
            businessID: entity.businessID,
            environment: entity.environment,
            softDelete: 'deleted',
        });
        const pointsArray = UserEntity.transformer(userEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, pointsArray);
        await cacheManager.del(entity.subject);
    }

    /**
     * The configuration rows of the credentials which the account holds within the
     * environment of the caller. Credentials which have already been retired are not
     * part of the accounts configuration any longer, and so are never returned.
     */
    private async getKeyRowsForAccount({
        businessID,
        subject,
    }: {
        businessID: string;
        subject: string;
    }): Promise<Array<UserTable>> {
        const accountID = businessID || (await this.resolveAccount(subject));
        if (!accountID) {
            throw new NotFoundException(`No account was found for subject: ${subject}`);
        }
        businessID = accountID;
        const { readAllUsersForBusiness } = this.InfluxService;
        const rows: Array<UserTable> = await readAllUsersForBusiness(businessID);
        const keyRows = (rows || []).filter(
            (row) => row?.businessID === businessID && KeyEntity.isMachineSubject(row?.subject),
        );
        const environments = new Set(keyRows.map((row) => row?.environment));
        if (environments.size > 1) {
            // An account which holds credentials in more than one environment can only
            // ever show the ones belonging to the environment of the caller.
            const environment = await this.getCallerEnvironment(subject);
            return keyRows.filter((row) => row?.environment === environment);
        }
        return keyRows;
    }

    /**
     * The account which the caller resolves to. The account always follows the
     * environment which the caller is currently operating within.
     */
    private async resolveAccount(subject: string): Promise<string> {
        const {
            data: [userEntity],
        } = await this.usersService.findOne({ subject });
        return userEntity?.businessID;
    }

    private async getCallerEnvironment(subject: string): Promise<Environment> {
        const { environment } = await this.environmentService.getCurrentEnvironment(subject);
        return environment;
    }

    /**
     * Resolves a credential named by a request against the credentials the account
     * holds. A credential which the account does not hold, be it one of another
     * tenant, one of the other environment of this tenant, one which was already
     * retired, or one which the identity provider holds but the tenant never claimed,
     * is refused, and is left exactly as it was.
     */
    private async findKeyForAccount({
        businessID,
        subject,
        keyId,
    }: {
        businessID: string;
        subject: string;
        keyId: string;
    }): Promise<KeyEntity> {
        const keyIdentifier = KeyEntity.subjectToKeyId(keyId);
        const keySubject = KeyEntity.keyIdToSubject(keyIdentifier);
        const rows = await this.getKeyRowsForAccount({ businessID, subject });
        const row = rows.find((current) => current?.subject === keySubject);
        if (!row) {
            KeysService.logger.warn(
                `Key: ${keyIdentifier} is not held by account: ${businessID}, refusing the request`,
            );
            throw new NotFoundException(`Key: ${keyIdentifier} was not found for the account`);
        }
        return KeyEntity.dbModelToEntity(row);
    }
}
