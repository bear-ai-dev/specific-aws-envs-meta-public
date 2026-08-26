import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { cache as cacheManager } from '../cacheStore.js';
import { InfluxService } from '../influx/influx.service.js';
import { Environment } from '../users/dto/Environment.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { EnvironmentService, UsersService } from '../users/users.service.js';
import { KeyResponseDataDto, ReadKeysResponseDto, RotateKeyResponseDto } from './dto/read-key.dto.js';
import {
    IdentityProviderClient,
    KeyEntity,
    clientIdToSubject,
    isMachineSubject,
    subjectToClientId,
} from './entities/key.entity.js';

/**
 * The account a request is made against, which is a tenant and one of its environments.
 */
export interface ResolvedAccount {
    businessID: string;
    environment: Environment;
}

@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        readonly influxService: InfluxService,
        readonly usersService: UsersService,
        readonly environmentService: EnvironmentService,
    ) {}

    /**
     * Resolves the account of the caller. The environment the caller is currently in, or the one
     * named on the request, decides which of the two accounts of the tenant is used, and the
     * configuration store has to still hold a live account for the caller in that environment.
     */
    async resolveAccount(subject: string, requestedEnvironment?: string): Promise<ResolvedAccount> {
        if (!subject) {
            throw new UnauthorizedException();
        }
        let environment: Environment;
        if (requestedEnvironment) {
            if (!Object.values(Environment).includes(requestedEnvironment as Environment)) {
                throw new BadRequestException(`Invalid Environment chosen: ${requestedEnvironment}`);
            }
            environment = requestedEnvironment as Environment;
        } else {
            ({ environment } = await this.environmentService.getCurrentEnvironment(subject));
        }

        const {
            data: [user],
        } = await this.usersService.findOne({ subject, environment });

        if (!user?.businessID) {
            throw new UnauthorizedException();
        }
        return { businessID: user.businessID, environment: user.environment ?? environment };
    }

    /**
     * Every machine credential the account holds in the environment the caller is in. Credentials
     * of the other environment of the tenant, of another tenant, of a retired integration, and
     * clients the identity provider holds which the tenant never claimed, are all left out.
     */
    async findAll({
        subject,
        requestedEnvironment,
    }: {
        subject: string;
        requestedEnvironment?: string;
    }): Promise<ReadKeysResponseDto> {
        const { businessID, environment } = await this.resolveAccount(subject, requestedEnvironment);
        const keys = await this.readKeysForAccount({ businessID, environment });

        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        let clientsById: Record<string, IdentityProviderClient> = {};
        try {
            const clients = await KeyEntity.listClients(access_token);
            clientsById = clients.reduce(
                (accumulator, client) => {
                    accumulator[client.client_id] = client;
                    return accumulator;
                },
                {} as Record<string, IdentityProviderClient>,
            );
        } catch (error) {
            // The account still holds the credentials even when the identity provider cannot be
            // asked for their display names.
            KeysService.logger.error(`Failed to list the clients of the identity provider`);
        }

        const data: KeyResponseDataDto[] = keys.map((keyId) => ({
            keyId,
            clientId: keyId,
            client_id: keyId,
            name: clientsById[keyId]?.name ?? keyId,
            subject: clientIdToSubject(keyId),
            businessID,
            environment,
        }));

        return { message: 'Found keys', data };
    }

    /**
     * Replaces the secret of a single credential of the account. Every other credential, of this
     * account and of every other, is left exactly as it was.
     */
    async rotate({
        subject,
        keyId,
        requestedEnvironment,
    }: {
        subject: string;
        keyId: string;
        requestedEnvironment?: string;
    }): Promise<RotateKeyResponseDto> {
        const { businessID, environment } = await this.resolveAccount(subject, requestedEnvironment);
        await this.assertAccountHoldsKey({ keyId, businessID, environment });

        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const client = await KeyEntity.rotateSecret(keyId, access_token);
        const clientSecret = client?.client_secret;
        KeysService.logger.log(`Rotated the secret of key: ${keyId} for businessID: ${businessID}`);

        return {
            message: `Rotated the secret for key: ${keyId}`,
            clientSecret,
            client_secret: clientSecret,
            data: [
                {
                    keyId,
                    clientId: keyId,
                    client_id: keyId,
                    name: client?.name ?? keyId,
                    subject: clientIdToSubject(keyId),
                    businessID,
                    environment,
                    clientSecret,
                    client_secret: clientSecret,
                },
            ],
        };
    }

    /**
     * Retires a credential of the account for good. It is withdrawn at the identity provider and
     * the account it signs in as is taken out of the configuration of the tenant, so a caller
     * still presenting it is refused from that moment onwards.
     */
    async remove({
        subject,
        keyId,
        requestedEnvironment,
    }: {
        subject: string;
        keyId: string;
        requestedEnvironment?: string;
    }): Promise<BasicResponseDTO> {
        const { businessID, environment } = await this.resolveAccount(subject, requestedEnvironment);
        await this.assertAccountHoldsKey({ keyId, businessID, environment });

        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        await KeyEntity.deleteClient(keyId, access_token);
        await this.usersService.softDelete({ subject: clientIdToSubject(keyId), businessID, environment });
        KeysService.logger.log(`Deleted key: ${keyId} of businessID: ${businessID}`);

        return { message: `Successfully deleted key: ${keyId}` };
    }

    /**
     * The ids of the machine credentials the account holds. Retired credentials are not part of the
     * configuration of the account anymore and so are not returned.
     */
    private async readKeysForAccount({
        businessID,
        environment,
    }: {
        businessID: string;
        environment: Environment;
    }): Promise<string[]> {
        const results = await this.influxService.readAllUsersForBusiness(businessID);
        const keys = results
            .filter((result) => isMachineSubject(result?.subject))
            .filter((result) => !result?.environment || result?.environment === environment)
            .map((result) => subjectToClientId(result.subject));
        return [...new Set(keys)].sort();
    }

    /**
     * A credential belongs to exactly one environment of one tenant. A request naming one the
     * current account does not hold is refused, and the credential is left exactly as it was.
     */
    private async assertAccountHoldsKey({
        keyId,
        businessID,
        environment,
    }: {
        keyId: string;
        businessID: string;
        environment: Environment;
    }): Promise<void> {
        if (!keyId) {
            throw new NotFoundException(`Key was not found`);
        }
        const results = await this.influxService.readUserData(clientIdToSubject(keyId), environment);
        const held = results.some((result) => result?.businessID === businessID);
        if (!held) {
            KeysService.logger.warn(
                `Key: ${keyId} is not held by businessID: ${businessID} in environment: ${environment}`,
            );
            throw new NotFoundException(`Key: ${keyId} was not found for this account`);
        }
    }
}
