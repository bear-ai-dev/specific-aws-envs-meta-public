import { Logger } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { Environment } from '../dto/Environment.js';

/**
 * The suffix which the identity provider gives to the subject of every token which is
 * minted from a machine credential. A machine credential with the client id `abc123` mints
 * tokens whose subject is `abc123@clients`, and that subject is the identity which the
 * platform stores account configuration under.
 */
export const CLIENT_SUBJECT_SUFFIX = '@clients';

export interface IdentityProviderClient {
    client_id: string;
    name?: string;
    app_type?: string;
    client_secret?: string;
    [x: string]: any;
}

/**
 * A machine credential (API key). A key always belongs to exactly one environment of exactly
 * one account, the link between the two being the configuration row which the platform keeps
 * for the subject the key signs in as.
 */
export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);
    public static readonly IDENTITY_PROVIDER_URL = 'https://auth.meteringco.example';

    public keyId: string;
    public name: string;
    public subject: string;
    public businessID: string;
    public environment: Environment;
    public appType: string;
    public clientSecret?: string;

    constructor({
        keyId,
        name,
        subject,
        businessID,
        environment,
        appType,
        clientSecret,
    }: {
        keyId: string;
        name?: string;
        subject?: string;
        businessID?: string;
        environment?: Environment;
        appType?: string;
        clientSecret?: string;
    }) {
        this.keyId = keyId;
        this.name = name;
        this.subject = subject ? subject : KeyEntity.subjectForKeyId(keyId);
        this.businessID = businessID;
        this.environment = environment;
        this.appType = appType;
        this.clientSecret = clientSecret;
    }

    /**
     * The subject a machine credential signs in as.
     */
    public static subjectForKeyId(keyId: string): string {
        return `${keyId}${CLIENT_SUBJECT_SUFFIX}`;
    }

    /**
     * The key id behind a subject, or undefined when the subject is not a machine credential.
     */
    public static keyIdForSubject(subject: string): string | undefined {
        if (!subject || !subject.endsWith(CLIENT_SUBJECT_SUFFIX)) {
            return undefined;
        }
        const keyId = subject.slice(0, subject.length - CLIENT_SUBJECT_SUFFIX.length);
        return keyId.length ? keyId : undefined;
    }

    public static isMachineCredentialSubject(subject: string): boolean {
        return Boolean(KeyEntity.keyIdForSubject(subject));
    }

    public toResponse(): { [x: string]: any } {
        const response: { [x: string]: any } = {
            keyId: this.keyId,
            client_id: this.keyId,
            clientId: this.keyId,
            name: this.name,
            subject: this.subject,
            businessID: this.businessID,
            environment: this.environment,
        };
        if (this.appType) {
            response.app_type = this.appType;
        }
        if (this.clientSecret) {
            response.client_secret = this.clientSecret;
            response.clientSecret = this.clientSecret;
        }
        return response;
    }

    /**
     * Look a machine credential up at the identity provider. Returns null when the identity
     * provider has no such credential, which is not an error: the platform's configuration and
     * the identity provider can disagree, and the configuration is not authoritative.
     */
    public static async findClient(keyId: string, accessToken: string): Promise<IdentityProviderClient | null> {
        const res = await fetch(`${KeyEntity.IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        if (res.status === 404) {
            return null;
        }
        if (!res.ok) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Error reading key: ${keyId} from the identity provider`,
                data: [{ status: res.status }],
            });
            throw new Error('Error reading key from the identity provider');
        }
        const jsonRes = await res.json();
        if (jsonRes?.statusCode === 404) {
            return null;
        }
        if (jsonRes?.error) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Error reading key: ${keyId} from the identity provider`,
                data: [jsonRes],
            });
            throw new Error('Error reading key from the identity provider');
        }
        return jsonRes;
    }

    /**
     * Replace the secret of a single machine credential. The client id survives the rotation,
     * every other credential is left exactly as it was.
     */
    public static async rotateSecret(keyId: string, accessToken: string): Promise<IdentityProviderClient> {
        KeyEntity.logger.debug(`Rotating the secret for key: ${keyId}`);
        const res = await fetch(
            `${KeyEntity.IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}/rotate-secret`,
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'cache-control': 'no-cache',
                },
            },
        );
        if (!res.ok) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Error rotating the secret for key: ${keyId}`,
                data: [{ status: res.status }],
            });
            throw new Error('Error rotating the secret for the key');
        }
        const jsonRes = await res.json();
        if (jsonRes?.error) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Error rotating the secret for key: ${keyId}`,
                data: [jsonRes],
            });
            throw new Error('Error rotating the secret for the key');
        }
        return jsonRes;
    }

    /**
     * Withdraw the machine credential at the identity provider, so that neither the secret which
     * was presented before nor a freshly rotated one mints anything from this moment onwards.
     */
    public static async deleteClient(keyId: string, accessToken: string): Promise<void> {
        KeyEntity.logger.debug(`Deleting key: ${keyId} at the identity provider`);
        const res = await fetch(`${KeyEntity.IDENTITY_PROVIDER_URL}/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        // A credential which is already gone at the identity provider is still withdrawn.
        if (!res.ok && res.status !== 404) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Error deleting key: ${keyId} at the identity provider`,
                data: [{ status: res.status }],
            });
            throw new Error('Error deleting the key at the identity provider');
        }
    }
}
