import { Logger, NotFoundException } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { UserTable } from '../../influx/entities/userTable.entity.js';
import { Environment } from '../dto/Environment.js';

/**
 * Machine to machine credentials, (API Keys) authenticate against the API with the
 * client credentials grant. Auth0 represents the caller of such a credential with a
 * subject of `<client_id>@clients`, which is the subject MeteringCo stores within its own
 * configuration in order to associate the credential with an account (businessID) and
 * an environment.
 */
export const CLIENT_SUBJECT_SUFFIX = '@clients';

export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);

    /**
     * The identifier of the credential at the identity provider, (the Auth0 client_id)
     */
    public keyId: string;
    /**
     * A human readable name for the credential
     */
    public name: string;
    /**
     * The subject which the credential signs in as. `<client_id>@clients`
     */
    public subject: string;
    /**
     * The account which holds the credential
     */
    public businessID: string;
    /**
     * The environment of the account which holds the credential
     */
    public environment: Environment;
    /**
     * Only ever populated directly after a secret has been rotated, the identity
     * provider never returns the secret of an existing credential again.
     */
    public clientSecret?: string;

    constructor({
        keyId,
        name,
        businessID,
        environment,
        clientSecret,
    }: {
        keyId: string;
        name?: string;
        businessID?: string;
        environment?: Environment;
        clientSecret?: string;
    }) {
        this.keyId = keyId;
        this.name = name;
        this.subject = KeyEntity.keyIdToSubject(keyId);
        this.businessID = businessID;
        this.environment = environment;
        this.clientSecret = clientSecret;
    }

    /**
     * The base url of the identity provider, requests to it are made with the
     * management credentials of the platform.
     */
    public static getIdentityProviderUrl(): string {
        const issuer = process.env.AUTH0_ISSUER_URL || 'https://auth.meteringco.example/';
        return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
    }

    public static keyIdToSubject(keyId: string): string {
        if (!keyId) {
            return keyId;
        }
        return keyId.endsWith(CLIENT_SUBJECT_SUFFIX) ? keyId : `${keyId}${CLIENT_SUBJECT_SUFFIX}`;
    }

    public static subjectToKeyId(subject: string): string {
        if (!subject) {
            return subject;
        }
        return subject.endsWith(CLIENT_SUBJECT_SUFFIX)
            ? subject.slice(0, subject.length - CLIENT_SUBJECT_SUFFIX.length)
            : subject;
    }

    /**
     * Only machine to machine credentials are API keys, the subjects of the people who
     * sign into the console are not.
     */
    public static isMachineSubject(subject: string): boolean {
        return typeof subject === 'string' && subject.endsWith(CLIENT_SUBJECT_SUFFIX);
    }

    public static dbModelToEntity(dbModel: UserTable): KeyEntity {
        return new KeyEntity({
            keyId: KeyEntity.subjectToKeyId(dbModel?.subject),
            businessID: dbModel?.businessID,
            environment: dbModel?.environment,
        });
    }

    private static async handleErrors(response, message: string, operation: string) {
        let body;
        try {
            body = await response.json();
        } catch (e) {
            KeyEntity.logger.debug(`Unable to parse the identity provider response for ${operation}`);
        }
        KeyEntity.logger.error(`${message}. Status: ${response?.status}. Body: ${JSON.stringify(body)}`);
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message,
            data: [{ status: response?.status, body, operation }],
        });
        if (response?.status === 404) {
            throw new NotFoundException(message);
        }
        throw new Error(message);
    }

    /**
     * All of the credentials which the identity provider holds.
     */
    public static async listClients(accessToken: string): Promise<Array<{ client_id: string; name?: string }>> {
        const res = await fetch(`${KeyEntity.getIdentityProviderUrl()}/api/v2/clients`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res?.ok) {
            await KeyEntity.handleErrors(res, 'Error listing the credentials at the identity provider', 'listClients');
        }
        const jsonRes = await res.json();
        return Array.isArray(jsonRes) ? jsonRes : jsonRes?.clients || [];
    }

    /**
     * A single credential held by the identity provider, null when it does not exist.
     */
    public static async findClient(keyId: string, accessToken: string): Promise<{ client_id: string; name?: string }> {
        const res = await fetch(`${KeyEntity.getIdentityProviderUrl()}/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        if (res?.status === 404) {
            return null;
        }
        if (!res?.ok) {
            await KeyEntity.handleErrors(res, 'Error reading the credential at the identity provider', 'findClient');
        }
        return await res.json();
    }

    /**
     * Replaces the secret of a single credential, every other credential is untouched.
     */
    public static async rotateClientSecret(keyId: string, accessToken: string): Promise<{ client_secret: string }> {
        const res = await fetch(
            `${KeyEntity.getIdentityProviderUrl()}/api/v2/clients/${encodeURIComponent(keyId)}/rotate-secret`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'cache-control': 'no-cache',
                },
            },
        );
        if (!res?.ok) {
            await KeyEntity.handleErrors(
                res,
                'Error rotating the secret of the credential at the identity provider',
                'rotateClientSecret',
            );
        }
        return await res.json();
    }

    /**
     * Withdraws the credential at the identity provider, after which it can no longer
     * be exchanged for an access token.
     */
    public static async deleteClient(keyId: string, accessToken: string): Promise<void> {
        const res = await fetch(`${KeyEntity.getIdentityProviderUrl()}/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        // A credential which is already gone from the identity provider is still
        // removed from the accounts configuration, so a 404 is not an error here.
        if (!res?.ok && res?.status !== 404) {
            await KeyEntity.handleErrors(res, 'Error deleting the credential at the identity provider', 'deleteClient');
        }
    }
}
