import { Logger } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { Environment } from '../dto/Environment.js';

/**
 * The suffix which the identity provider appends to a machine credential's
 * client id when it mints a token for it. The platform stores the account
 * configuration for a machine credential under that subject.
 */
export const CLIENT_SUBJECT_SUFFIX = '@clients';
const IDENTITY_CLIENTS_URL = 'https://auth.meteringco.example/api/v2/clients';

export type IdentityClient = {
    client_id: string;
    name?: string;
    app_type?: string;
    client_secret?: string;
    [x: string]: unknown;
};

/**
 * An API key (a machine credential) which an account holds.
 *
 * A key lives in exactly one environment of exactly one account. The identity
 * provider holds the credential itself (the client id and its secret) while
 * the platform's configuration store holds the account, and the environment of
 * that account, which the credential signs in as.
 */
export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);

    public keyId: string;
    public name: string;
    public businessID: string;
    public environment: Environment;
    public subject: string;
    public appType: string;

    constructor({
        keyId,
        name,
        businessID,
        environment,
        appType,
    }: {
        keyId: string;
        name?: string;
        businessID?: string;
        environment?: Environment;
        appType?: string;
    }) {
        this.keyId = keyId;
        this.name = name ? name : keyId;
        this.businessID = businessID;
        this.environment = environment;
        this.subject = KeyEntity.clientIdToSubject(keyId);
        this.appType = appType;
    }

    /**
     * Turns the subject which the platform stores configuration under back into
     * the client id which the identity provider knows the credential by.
     */
    public static subjectToClientId(subject: string): string {
        if (!subject) {
            return subject;
        }
        return subject.endsWith(CLIENT_SUBJECT_SUFFIX)
            ? subject.slice(0, subject.length - CLIENT_SUBJECT_SUFFIX.length)
            : subject;
    }

    public static clientIdToSubject(clientId: string): string {
        if (!clientId) {
            return clientId;
        }
        return clientId.endsWith(CLIENT_SUBJECT_SUFFIX) ? clientId : `${clientId}${CLIENT_SUBJECT_SUFFIX}`;
    }

    /**
     * Only machine credentials sign in as a `@clients` subject, a person who
     * signs in to the console does not.
     */
    public static isMachineSubject(subject: string): boolean {
        return Boolean(subject) && subject.endsWith(CLIENT_SUBJECT_SUFFIX);
    }

    /**
     * Reads a single credential from the identity provider. Returns null when
     * the identity provider does not hold it (any more).
     */
    public static async findClient(clientId: string, accessToken: string): Promise<IdentityClient | null> {
        const res = await fetch(`${IDENTITY_CLIENTS_URL}/${encodeURIComponent(clientId)}`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        if (res.status === 404) {
            KeyEntity.logger.warn(`Identity provider does not hold a client for ${clientId}`);
            return null;
        }
        if (!res.ok) {
            await KeyEntity.handleError(res, `Error reading client ${clientId} from the identity provider`);
        }
        return (await res.json()) as IdentityClient;
    }

    /**
     * Replaces the secret of a single credential in place. The client id
     * survives and no other credential is touched.
     */
    public static async rotateSecret(clientId: string, accessToken: string): Promise<IdentityClient> {
        KeyEntity.logger.debug(`Rotating the secret for client ${clientId}`);
        const res = await fetch(`${IDENTITY_CLIENTS_URL}/${encodeURIComponent(clientId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok) {
            await KeyEntity.handleError(res, `Error rotating the secret for client ${clientId}`);
        }
        return (await res.json()) as IdentityClient;
    }

    /**
     * Withdraws the credential at the identity provider, so neither the secret
     * it had nor a rotated one will mint a token afterwards. Returns false when
     * the identity provider already did not hold it.
     */
    public static async deleteClient(clientId: string, accessToken: string): Promise<boolean> {
        KeyEntity.logger.debug(`Deleting client ${clientId} at the identity provider`);
        const res = await fetch(`${IDENTITY_CLIENTS_URL}/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        if (res.status === 404) {
            KeyEntity.logger.warn(`Client ${clientId} was already withdrawn at the identity provider`);
            return false;
        }
        if (!res.ok) {
            await KeyEntity.handleError(res, `Error deleting client ${clientId} at the identity provider`);
        }
        return true;
    }

    private static async handleError(res: { status: number; json: () => Promise<any> }, message: string) {
        let body;
        try {
            body = await res.json();
        } catch (e) {
            body = { status: res.status };
        }
        KeyEntity.logger.error(`${message}: ${JSON.stringify(body)}`);
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message,
            data: [body],
        });
        throw new Error(message);
    }
}
