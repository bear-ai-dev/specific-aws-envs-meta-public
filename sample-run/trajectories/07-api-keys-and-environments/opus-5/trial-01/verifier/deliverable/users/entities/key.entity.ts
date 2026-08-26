import { InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { Environment } from '../dto/Environment.js';

/**
 * Every machine credential signs in as an account of its own at the identity provider, the subject of
 * which is the client id followed by this suffix. That subject is the identity the platform keeps the
 * account configuration of the credential under.
 */
export const CLIENTS_SUBJECT_SUFFIX = '@clients';

const IDENTITY_PROVIDER_URL = 'https://auth.meteringco.example';
const CLIENTS_PER_PAGE = 100;
const MAX_CLIENT_PAGES = 100;

export interface IdentityProviderClient {
    client_id: string;
    name?: string;
    app_type?: string;
    client_secret?: string;
}

/**
 * A machine credential (an "API key") which an account holds in one environment.
 *
 * A key belongs to exactly one environment of exactly one tenant: the identity provider holds the
 * credential itself, while the platform configuration says which account, and which environment of
 * that account, the credential speaks for.
 */
export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);

    /**
     * The id of the credential at the identity provider, which is what a caller of this API names a
     * key by.
     */
    public keyId: string;
    /**
     * Alias of `keyId`, the identity provider calls it the client id.
     */
    public clientId: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public client_id: string;
    /**
     * The human readable name of the credential, as held by the identity provider.
     */
    public name: string;
    /**
     * The subject the credential signs in as.
     */
    public subject: string;
    /**
     * The account which holds the credential.
     */
    public businessID: string;
    /**
     * The environment of the account which holds the credential.
     */
    public environment: Environment;
    /**
     * Only ever populated by a rotation, the secret is never readable afterwards.
     */
    public clientSecret?: string;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public client_secret?: string;

    constructor({
        keyId,
        name,
        subject,
        businessID,
        environment,
        clientSecret,
    }: {
        keyId: string;
        name?: string;
        subject?: string;
        businessID?: string;
        environment?: Environment;
        clientSecret?: string;
    }) {
        this.keyId = keyId;
        this.clientId = keyId;
        this.client_id = keyId;
        this.name = name;
        this.subject = subject ? subject : KeyEntity.clientIdToSubject(keyId);
        this.businessID = businessID;
        this.environment = environment;
        if (clientSecret) {
            this.clientSecret = clientSecret;
            this.client_secret = clientSecret;
        }
    }

    public static clientIdToSubject(clientId: string): string {
        return `${clientId}${CLIENTS_SUBJECT_SUFFIX}`;
    }

    public static subjectToClientId(subject: string): string {
        return subject?.endsWith(CLIENTS_SUBJECT_SUFFIX)
            ? subject.slice(0, subject.length - CLIENTS_SUBJECT_SUFFIX.length)
            : subject;
    }

    public static isKeySubject(subject: string): boolean {
        return Boolean(subject) && subject.endsWith(CLIENTS_SUBJECT_SUFFIX);
    }

    private static headers(accessToken: string) {
        return {
            'content-type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
        };
    }

    private static async handleError(res, message: string) {
        let body;
        try {
            body = await res.json();
        } catch (e) {
            body = { status: res?.status };
        }
        KeyEntity.logger.error(`${message}: ${JSON.stringify(body)}`);
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message,
            data: [body],
        });
        throw new InternalServerErrorException(message);
    }

    /**
     * Every credential the identity provider holds, keyed by its id.
     *
     * The listing is asked for without the secret fields, they are only ever handed back by a
     * rotation. It is paginated, so every page is walked.
     */
    public static async listClients(accessToken: string): Promise<Map<string, IdentityProviderClient>> {
        const clients = new Map<string, IdentityProviderClient>();
        for (let page = 0; page < MAX_CLIENT_PAGES; page += 1) {
            const res = await fetch(
                `${IDENTITY_PROVIDER_URL}/api/v2/clients?page=${page}&per_page=${CLIENTS_PER_PAGE}&fields=client_secret&include_fields=false`,
                {
                    method: 'GET',
                    headers: KeyEntity.headers(accessToken),
                },
            );
            if (!res?.ok) {
                await KeyEntity.handleError(res, 'Error listing keys from the identity provider');
            }
            const jsonRes = await res.json();
            const pageOfClients: IdentityProviderClient[] = Array.isArray(jsonRes) ? jsonRes : jsonRes?.clients;
            if (!pageOfClients?.length) {
                break;
            }
            pageOfClients.forEach((client) => {
                if (client?.client_id) {
                    clients.set(client.client_id, client);
                }
            });
            if (pageOfClients.length < CLIENTS_PER_PAGE) {
                break;
            }
        }
        return clients;
    }

    /**
     * Replaces the secret of a single credential, every other credential is left exactly as it was.
     */
    public static async rotateSecret(keyId: string, accessToken: string): Promise<IdentityProviderClient> {
        const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}/rotate-secret`, {
            method: 'POST',
            headers: KeyEntity.headers(accessToken),
        });
        if (res?.status === 404) {
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        if (!res?.ok) {
            await KeyEntity.handleError(res, `Error rotating the secret for key: ${keyId}`);
        }
        return await res.json();
    }

    /**
     * Withdraws the credential at the identity provider, from which point neither the old secret nor a
     * freshly rotated one can obtain a token.
     */
    public static async deleteClient(keyId: string, accessToken: string): Promise<void> {
        const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
            headers: KeyEntity.headers(accessToken),
        });
        if (res?.status === 404) {
            throw new NotFoundException(`Key: ${keyId} was not found`);
        }
        if (!res?.ok) {
            await KeyEntity.handleError(res, `Error deleting key: ${keyId}`);
        }
    }
}
