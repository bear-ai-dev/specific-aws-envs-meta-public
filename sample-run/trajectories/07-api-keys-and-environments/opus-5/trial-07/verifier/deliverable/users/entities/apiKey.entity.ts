import { InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

const CLIENTS_URL = 'https://auth.meteringco.example/api/v2/clients';
/**
 * The identity provider caps a page of clients, so the listing is walked rather
 * than asked for in one go. The page cap is a guard against an unbounded loop
 * if the provider ever stops advancing.
 */
const CLIENTS_PER_PAGE = 100;
const MAX_CLIENT_PAGES = 100;

export const MACHINE_SUBJECT_SUFFIX = '@clients';

export interface IdentityProviderClient {
    client_id: string;
    name?: string;
    app_type?: string;
    client_secret?: string;
}

/**
 * An API key is a machine credential (a `client_credentials` application) held
 * by the identity provider. The account which owns it, and the environment of
 * that account, are held by MeteringCo against the subject the credential
 * authenticates as: `<client_id>@clients`.
 */
export class ApiKeyEntity {
    private static readonly logger = new Logger(ApiKeyEntity.name);

    /**
     * The subject a token minted from the given key authenticates as.
     */
    public static subjectForKeyId(keyId: string): string {
        return `${keyId}${MACHINE_SUBJECT_SUFFIX}`;
    }

    /**
     * True when the subject belongs to a machine credential rather than a person.
     */
    public static isMachineSubject(subject: string): boolean {
        return typeof subject === 'string' && subject.endsWith(MACHINE_SUBJECT_SUFFIX);
    }

    /**
     * The key a machine subject was minted from, or undefined for a person.
     */
    public static keyIdForSubject(subject: string): string | undefined {
        if (!ApiKeyEntity.isMachineSubject(subject)) {
            return undefined;
        }
        return subject.slice(0, subject.length - MACHINE_SUBJECT_SUFFIX.length);
    }

    private static headers(accessToken: string) {
        return {
            'content-type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
        };
    }

    private static async handleError(response, message: string, keyId?: string) {
        let body;
        try {
            body = await response.json();
        } catch (e) {
            body = { status: response?.status };
        }
        if (response?.status === 404) {
            throw new NotFoundException(keyId ? `Key: ${keyId} was not found` : message);
        }
        ApiKeyEntity.logger.error(`${message}: ${JSON.stringify(body)}`);
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message,
            data: [body],
        });
        throw new InternalServerErrorException(message);
    }

    /**
     * Every client the identity provider holds, keyed by its id.
     *
     * Secrets are explicitly excluded from the listing: `include_fields=false`
     * turns the field selection into a blacklist, so a listing never carries
     * secret material back to the console.
     */
    public static async listClients(accessToken: string): Promise<Map<string, IdentityProviderClient>> {
        const clients = new Map<string, IdentityProviderClient>();
        for (let page = 0; page < MAX_CLIENT_PAGES; page++) {
            const query = new URLSearchParams({
                fields: 'client_secret',
                include_fields: 'false',
                include_totals: 'true',
                per_page: `${CLIENTS_PER_PAGE}`,
                page: `${page}`,
            });
            const response = await fetch(`${CLIENTS_URL}?${query.toString()}`, {
                method: 'GET',
                headers: ApiKeyEntity.headers(accessToken),
            });
            if (!response?.ok) {
                await ApiKeyEntity.handleError(response, 'Error listing the keys held by the identity provider');
            }
            const body = await response.json();
            const page_of_clients: Array<IdentityProviderClient> = Array.isArray(body) ? body : body?.clients || [];
            page_of_clients.forEach((client) => {
                if (client?.client_id) {
                    clients.set(client.client_id, client);
                }
            });
            const total = Array.isArray(body) ? page_of_clients.length : body?.total;
            if (!page_of_clients.length || (typeof total === 'number' && clients.size >= total)) {
                break;
            }
        }
        return clients;
    }

    /**
     * Replace the secret of a single key. Nothing else about the key, and no
     * other key, is touched: the id survives and the previous secret stops
     * minting tokens immediately.
     */
    public static async rotateSecret(keyId: string, accessToken: string): Promise<IdentityProviderClient> {
        const response = await fetch(`${CLIENTS_URL}/${encodeURIComponent(keyId)}/rotate-secret`, {
            method: 'POST',
            headers: ApiKeyEntity.headers(accessToken),
        });
        if (!response?.ok) {
            await ApiKeyEntity.handleError(response, `Error rotating the secret for key: ${keyId}`, keyId);
        }
        return response.json();
    }

    /**
     * Withdraw the credential at the identity provider. Once it is gone neither
     * the old secret nor a freshly rotated one will mint another token.
     */
    public static async deleteClient(keyId: string, accessToken: string): Promise<void> {
        const response = await fetch(`${CLIENTS_URL}/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
            headers: ApiKeyEntity.headers(accessToken),
        });
        if (!response?.ok) {
            await ApiKeyEntity.handleError(response, `Error deleting key: ${keyId}`, keyId);
        }
    }
}
