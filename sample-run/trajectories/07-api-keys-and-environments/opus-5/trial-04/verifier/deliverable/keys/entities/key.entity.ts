import { Logger, NotFoundException } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { Environment } from '../../users/dto/Environment.js';

const IDENTITY_PROVIDER_MANAGEMENT_API = 'https://auth.meteringco.example/api/v2';
const CLIENTS_PER_PAGE = 100;
const MAX_PAGES = 100;

/**
 * The subject an identity provider mints for a machine credential is the client id with this
 * suffix, and that subject is the account the platform stores the configuration of the credential
 * under.
 */
export const CLIENT_SUBJECT_SUFFIX = '@clients';

export const clientIdToSubject = (clientId: string): string => `${clientId}${CLIENT_SUBJECT_SUFFIX}`;

export const subjectToClientId = (subject: string): string =>
    subject?.endsWith(CLIENT_SUBJECT_SUFFIX) ? subject.slice(0, -CLIENT_SUBJECT_SUFFIX.length) : undefined;

export const isMachineSubject = (subject: string): boolean =>
    Boolean(subject) && subject.endsWith(CLIENT_SUBJECT_SUFFIX);

export interface IdentityProviderClient {
    client_id: string;
    name?: string;
    app_type?: string;
    client_secret?: string;
}

/**
 * A machine credential of an account. It exists in two places: the identity provider holds the
 * client which mints tokens for it, and the configuration store holds the account the tokens of
 * that client sign in as. A credential belongs to exactly one environment of one tenant.
 */
export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);

    public keyId: string;
    public name: string;
    public subject: string;
    public businessID: string;
    public environment: Environment;

    constructor({
        keyId,
        name,
        businessID,
        environment,
    }: {
        keyId: string;
        name?: string;
        businessID: string;
        environment: Environment;
    }) {
        this.keyId = keyId;
        this.name = name;
        this.subject = clientIdToSubject(keyId);
        this.businessID = businessID;
        this.environment = environment;
    }

    private static headers(accessToken: string) {
        return {
            'content-type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            'cache-control': 'no-cache',
        };
    }

    /**
     * Every client the identity provider holds. Asked for without the secret fields so a listing
     * can never carry a secret back to a caller.
     */
    public static async listClients(accessToken: string): Promise<IdentityProviderClient[]> {
        const clients: IdentityProviderClient[] = [];
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const res = await fetch(
                `${IDENTITY_PROVIDER_MANAGEMENT_API}/clients?include_fields=false&fields=client_secret&per_page=${CLIENTS_PER_PAGE}&page=${page}`,
                { method: 'GET', headers: KeyEntity.headers(accessToken) },
            );
            if (!res?.ok) {
                await KeyEntity.handleError(res, 'Error listing clients from the identity provider');
            }
            const jsonRes = await res.json();
            const pageOfClients: IdentityProviderClient[] = Array.isArray(jsonRes) ? jsonRes : jsonRes?.clients ?? [];
            clients.push(...pageOfClients);
            if (pageOfClients.length < CLIENTS_PER_PAGE) {
                break;
            }
        }
        return clients;
    }

    /**
     * Replaces the secret of a single client. Nothing else about the client, and no other client,
     * is touched.
     */
    public static async rotateSecret(clientId: string, accessToken: string): Promise<IdentityProviderClient> {
        KeyEntity.logger.debug(`Rotating the secret of client: ${clientId}`);
        const res = await fetch(
            `${IDENTITY_PROVIDER_MANAGEMENT_API}/clients/${encodeURIComponent(clientId)}/rotate-secret`,
            { method: 'POST', headers: KeyEntity.headers(accessToken) },
        );
        if (res?.status === 404) {
            // The identity provider no longer holds the client, there is no secret to replace.
            throw new NotFoundException(`Key: ${clientId} was not found`);
        }
        if (!res?.ok) {
            await KeyEntity.handleError(res, `Error rotating the secret of client: ${clientId}`);
        }
        return res.json();
    }

    /**
     * Withdraws a client at the identity provider, so neither the old secret nor a freshly rotated
     * one mints anything afterwards.
     */
    public static async deleteClient(clientId: string, accessToken: string): Promise<void> {
        KeyEntity.logger.debug(`Deleting client: ${clientId}`);
        const res = await fetch(`${IDENTITY_PROVIDER_MANAGEMENT_API}/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: KeyEntity.headers(accessToken),
        });
        if (res?.status === 404) {
            // Already withdrawn at the identity provider, the account it signs in as still has to
            // be taken out of the configuration of the tenant.
            KeyEntity.logger.warn(`Client: ${clientId} was already withdrawn at the identity provider`);
            return;
        }
        if (!res?.ok) {
            await KeyEntity.handleError(res, `Error deleting client: ${clientId}`);
        }
    }

    private static async handleError(res, message: string) {
        let body;
        try {
            body = await res?.json();
        } catch (e) {
            body = undefined;
        }
        KeyEntity.logger.error(`${message}. Status: ${res?.status}. Body: ${JSON.stringify(body)}`);
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message,
            data: [{ status: res?.status, body }],
        });
        throw new Error(message);
    }
}
