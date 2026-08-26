import { Logger } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { cache as cacheManager } from '../../cacheStore.js';
import { Environment } from '../dto/Environment.js';
import { ReadKeyDTO } from '../dto/read-keys.dto.js';
import { OrganizationEntity } from './organization.entity.js';

/**
 * The identity provider which holds the machine credentials (API keys) of every account.
 * The host is rewritten to the local identity provider when running outside of the cloud.
 */
export const IDENTITY_PROVIDER_URL = 'https://auth.meteringco.example';

/**
 * Every machine credential signs in as a client, and every client has a subject of
 * `<client_id>@clients`. That subject is the identity the platform stores its account
 * configuration under.
 */
export const CLIENT_SUBJECT_SUFFIX = '@clients';

const MAX_PAGE_SIZE = 100;
const MAX_PAGES = 100;

export type IdentityProviderClient = {
    client_id: string;
    name?: string;
    app_type?: string;
    client_secret?: string;
};

/**
 * A machine credential belonging to exactly one environment of exactly one account.
 */
export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);

    public clientId: string;

    public name: string;

    public subject: string;

    public businessID: string;

    public environment: Environment;

    public clientSecret: string;

    constructor({
        clientId,
        name,
        subject,
        businessID,
        environment,
        clientSecret,
    }: {
        clientId: string;
        name?: string;
        subject?: string;
        businessID?: string;
        environment?: Environment;
        clientSecret?: string;
    }) {
        this.clientId = clientId;
        this.name = name;
        this.subject = subject ? subject : KeyEntity.subjectForClientId(clientId);
        this.businessID = businessID;
        this.environment = environment;
        this.clientSecret = clientSecret;
    }

    /**
     * The subject a machine credential signs in as
     */
    public static subjectForClientId(clientId: string): string {
        return `${clientId}${CLIENT_SUBJECT_SUFFIX}`;
    }

    /**
     * The credential a subject belongs to, if that subject is a machine credential at all
     */
    public static clientIdForSubject(subject: string): string | undefined {
        if (!subject || !subject.endsWith(CLIENT_SUBJECT_SUFFIX)) {
            return undefined;
        }
        const clientId = subject.slice(0, subject.length - CLIENT_SUBJECT_SUFFIX.length);
        return clientId.length ? clientId : undefined;
    }

    /**
     * Callers may name a key either by its client id, or by the subject it signs in as
     */
    public static normalizeKeyId(keyId: string): string {
        if (!keyId) {
            return keyId;
        }
        const trimmed = keyId.trim();
        return KeyEntity.clientIdForSubject(trimmed) ?? trimmed;
    }

    public static async getManagementToken(): Promise<string> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        return access_token;
    }

    private static headers(accessToken: string) {
        return {
            'content-type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
        };
    }

    private static async handleError(response, message: string) {
        let body;
        try {
            body = await response.json();
        } catch (e) {
            body = { status: response?.status };
        }
        KeyEntity.logger.error(`${message}: ${JSON.stringify(body)}`);
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message,
            data: [body],
        });
        throw new Error(message);
    }

    /**
     * Every client the identity provider holds. The listing is paginated, and it never
     * carries secrets, since secrets are only ever handed out once when they are created
     * or rotated.
     */
    public static async listClients(accessToken: string): Promise<Array<IdentityProviderClient>> {
        const clients: Array<IdentityProviderClient> = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const url = `${IDENTITY_PROVIDER_URL}/api/v2/clients?include_totals=true&per_page=${MAX_PAGE_SIZE}&page=${page}&fields=client_secret,signing_keys&include_fields=false`;
            const res = await fetch(url, { method: 'GET', headers: KeyEntity.headers(accessToken) });
            if (!res?.ok) {
                await KeyEntity.handleError(res, 'Error listing the keys held by the identity provider');
            }
            const body = await res.json();
            const batch: Array<IdentityProviderClient> = Array.isArray(body) ? body : body?.clients ?? [];
            clients.push(...batch);
            const total = Array.isArray(body) ? batch.length : body?.total;
            if (!batch.length || typeof total !== 'number' || clients.length >= total) {
                break;
            }
        }
        return clients;
    }

    /**
     * A single client, or `undefined` when the identity provider does not hold it
     */
    public static async findClient(clientId: string, accessToken: string): Promise<IdentityProviderClient> {
        const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'GET',
            headers: KeyEntity.headers(accessToken),
        });
        if (res?.status === 404) {
            return undefined;
        }
        if (!res?.ok) {
            await KeyEntity.handleError(res, `Error reading key: ${clientId} from the identity provider`);
        }
        const body = await res.json();
        if (!body?.client_id || body?.statusCode === 404) {
            return undefined;
        }
        return body;
    }

    /**
     * Replaces the secret of a single credential in place. The id survives, the previous
     * secret is refused from the next request onwards, and no other credential is touched.
     */
    public static async rotateSecret(clientId: string, accessToken: string): Promise<IdentityProviderClient> {
        const res = await fetch(
            `${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(clientId)}/rotate-secret`,
            {
                method: 'POST',
                headers: KeyEntity.headers(accessToken),
            },
        );
        if (!res?.ok) {
            await KeyEntity.handleError(res, `Error rotating the secret for key: ${clientId}`);
        }
        return await res.json();
    }

    /**
     * Withdraws the credential at the identity provider, so neither the old secret nor a
     * freshly rotated one can mint anything afterwards.
     */
    public static async deleteClient(clientId: string, accessToken: string): Promise<void> {
        const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: KeyEntity.headers(accessToken),
        });
        if (!res?.ok && res?.status !== 404) {
            await KeyEntity.handleError(res, `Error deleting key: ${clientId}`);
        }
    }

    public toResponse(): ReadKeyDTO {
        return {
            keyId: this.clientId,
            clientId: this.clientId,
            client_id: this.clientId,
            name: this.name,
            clientName: this.name,
            subject: this.subject,
            businessID: this.businessID,
            environment: this.environment,
        };
    }
}
