import { Logger } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { Environment } from '../../users/dto/Environment.js';

/**
 * The suffix the identity provider gives to the account a machine credential
 * signs in as. A credential with the id `abc123` speaks as `abc123@clients`,
 * and that is the identity the platform stores its configuration under.
 */
export const CLIENT_SUBJECT_SUFFIX = '@clients';

const IDENTITY_PROVIDER_URL = 'https://auth.meteringco.example';
const MAX_CLIENTS_PER_PAGE = 100;
// A tenant is never expected to hold anywhere near this many credentials, the
// bound only exists so a misbehaving provider cannot spin the listing forever.
const MAX_CLIENT_PAGES = 50;

export type IdentityProviderClient = {
    client_id: string;
    name?: string;
    app_type?: string;
    client_secret?: string;
};

/**
 * A machine credential (an "API key") held by the tenant identity provider.
 *
 * The credential itself lives at the identity provider, the fact that a tenant
 * holds it in one of its environments lives in the platform configuration
 * store, keyed by the account the credential signs in as. Both halves have to
 * agree before a credential is considered to belong to an account.
 */
export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);

    /** The identity provider's id for the credential, i.e. the client id */
    public keyId: string;
    /** The account the credential signs in as, `<keyId>@clients` */
    public subject: string;
    /** The human readable name given to the credential */
    public name: string;
    public appType: string;
    /** The account (tenant + environment) the credential belongs to */
    public businessID: string;
    public environment: Environment;
    /** Only ever populated straight after a rotation */
    public clientSecret?: string;

    constructor({
        keyId,
        name,
        appType,
        businessID,
        environment,
        clientSecret,
    }: {
        keyId: string;
        name?: string;
        appType?: string;
        businessID?: string;
        environment?: Environment;
        clientSecret?: string;
    }) {
        this.keyId = keyId;
        this.subject = KeyEntity.subjectForKeyId(keyId);
        this.name = name;
        this.appType = appType;
        this.businessID = businessID;
        this.environment = environment;
        this.clientSecret = clientSecret;
    }

    public static subjectForKeyId(keyId: string): string {
        if (!keyId) {
            return keyId;
        }
        return keyId.endsWith(CLIENT_SUBJECT_SUFFIX) ? keyId : `${keyId}${CLIENT_SUBJECT_SUFFIX}`;
    }

    public static keyIdForSubject(subject: string): string {
        if (!subject) {
            return subject;
        }
        return subject.endsWith(CLIENT_SUBJECT_SUFFIX)
            ? subject.slice(0, subject.length - CLIENT_SUBJECT_SUFFIX.length)
            : subject;
    }

    /**
     * Is this configuration subject one of a machine credential, as opposed to
     * a person who signs in to the console?
     */
    public static isMachineSubject(subject: string): boolean {
        return typeof subject === 'string' && subject.endsWith(CLIENT_SUBJECT_SUFFIX);
    }

    private static headers(accessToken: string) {
        return {
            'content-type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
        };
    }

    /**
     * Every credential the identity provider holds for this deployment.
     *
     * Secrets are deliberately excluded from the listing: `include_fields=false`
     * turns the `fields` selection into a blacklist so no secret material is
     * ever carried back for a screen that only needs to name credentials.
     */
    public static async listClients(accessToken: string): Promise<Map<string, IdentityProviderClient>> {
        const clients = new Map<string, IdentityProviderClient>();
        for (let page = 0; page < MAX_CLIENT_PAGES; page++) {
            const query = new URLSearchParams({
                page: `${page}`,
                per_page: `${MAX_CLIENTS_PER_PAGE}`,
                include_totals: 'true',
                fields: 'client_secret',
                include_fields: 'false',
            });
            const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients?${query.toString()}`, {
                method: 'GET',
                headers: KeyEntity.headers(accessToken),
            });
            if (!res?.ok) {
                const body = await res.text();
                KeyEntity.logger.error(`Failed to list clients from the identity provider: ${body}`);
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Error listing identity provider clients',
                    data: [{ status: res?.status, body }],
                });
                throw new Error('Error listing identity provider clients');
            }
            const jsonRes = await res.json();
            const window: IdentityProviderClient[] = Array.isArray(jsonRes) ? jsonRes : jsonRes?.clients || [];
            window.forEach((client) => {
                if (client?.client_id) {
                    clients.set(client.client_id, client);
                }
            });
            const total = Array.isArray(jsonRes) ? undefined : jsonRes?.total;
            if (!window.length || window.length < MAX_CLIENTS_PER_PAGE) {
                break;
            }
            if (typeof total === 'number' && clients.size >= total) {
                break;
            }
        }
        return clients;
    }

    /**
     * A single credential, or `undefined` when the identity provider has no
     * such credential (including one that has already been retired).
     */
    public static async findClient(keyId: string, accessToken: string): Promise<IdentityProviderClient | undefined> {
        const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'GET',
            headers: KeyEntity.headers(accessToken),
        });
        if (res?.status === 404) {
            return undefined;
        }
        if (!res?.ok) {
            const body = await res.text();
            KeyEntity.logger.error(`Failed to read client ${keyId} from the identity provider: ${body}`);
            throw new Error('Error reading identity provider client');
        }
        const jsonRes = await res.json();
        if (!jsonRes?.client_id || jsonRes?.statusCode === 404) {
            return undefined;
        }
        return jsonRes;
    }

    /**
     * Replace the secret on a single credential. The id survives the rotation
     * and no other credential is touched.
     */
    public static async rotateSecret(keyId: string, accessToken: string): Promise<IdentityProviderClient> {
        const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}/rotate-secret`, {
            method: 'POST',
            headers: KeyEntity.headers(accessToken),
        });
        if (!res?.ok) {
            const body = await res.text();
            KeyEntity.logger.error(`Failed to rotate the secret for client ${keyId}: ${body}`);
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Error rotating identity provider client secret',
                data: [{ keyId, status: res?.status, body }],
            });
            throw new Error('Error rotating identity provider client secret');
        }
        return res.json();
    }

    /** Withdraw the credential at the identity provider, for good. */
    public static async deleteClient(keyId: string, accessToken: string): Promise<void> {
        const res = await fetch(`${IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
            headers: KeyEntity.headers(accessToken),
        });
        if (!res?.ok && res?.status !== 404) {
            const body = await res.text();
            KeyEntity.logger.error(`Failed to delete client ${keyId}: ${body}`);
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Error deleting identity provider client',
                data: [{ keyId, status: res?.status, body }],
            });
            throw new Error('Error deleting identity provider client');
        }
    }
}
