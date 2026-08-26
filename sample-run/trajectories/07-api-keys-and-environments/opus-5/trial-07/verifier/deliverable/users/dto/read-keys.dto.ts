import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Environment } from './Environment.js';

/**
 * A machine credential (an API key) held by an account in a single environment.
 *
 * The identity provider names a credential `client_id`, the console addresses it
 * as `keyId` and the dashboard reads `clientId`, so the one value is returned
 * under each of those names.
 */
export class ReadKeyDTO {
    /**
     * The identifier of the key at the identity provider
     * @example "aabbbcbaksjdhka"
     */
    client_id: string;

    /**
     * The identifier of the key at the identity provider
     * @example "aabbbcbaksjdhka"
     */
    clientId: string;

    /**
     * The identifier of the key at the identity provider
     * @example "aabbbcbaksjdhka"
     */
    keyId: string;

    /**
     * The human readable name given to the key
     * @example "Production ingest"
     */
    name: string;

    /**
     * The subject a token minted from this key authenticates as
     * @example "aabbbcbaksjdhka@clients"
     */
    subject: string;

    /**
     * The account the key belongs to
     * @example "myCoolCorp"
     */
    businessID: string;

    /**
     * The environment of the account the key belongs to
     * @example "production"
     */
    @ApiProperty({ enum: Environment })
    environment: Environment;

    constructor({
        clientId,
        name,
        subject,
        businessID,
        environment,
    }: {
        clientId: string;
        name: string;
        subject: string;
        businessID: string;
        environment: Environment;
    }) {
        this.client_id = clientId;
        this.clientId = clientId;
        this.keyId = clientId;
        this.name = name;
        this.subject = subject;
        this.businessID = businessID;
        this.environment = environment;
    }
}

/**
 * Every key the current account holds in the environment the caller is in.
 */
export class ReadKeysResponseDTO extends BasicResponseDTO {
    data: Array<ReadKeyDTO>;

    constructor(message: string, data: Array<ReadKeyDTO>) {
        super();
        this.message = message;
        this.data = data;
    }
}

/**
 * The freshly minted secret for a key. The secret is only ever shown here, the
 * identity provider will not hand it back a second time.
 */
export class RotateKeyResponseDTO extends BasicResponseDTO {
    client_id: string;

    clientId: string;

    keyId: string;

    client_secret: string;

    clientSecret: string;

    name: string;

    subject: string;

    data: Array<Record<string, unknown>>;

    constructor({
        message,
        clientId,
        clientSecret,
        name,
        subject,
    }: {
        message: string;
        clientId: string;
        clientSecret: string;
        name: string;
        subject: string;
    }) {
        super();
        this.message = message;
        this.client_id = clientId;
        this.clientId = clientId;
        this.keyId = clientId;
        this.client_secret = clientSecret;
        this.clientSecret = clientSecret;
        this.name = name;
        this.subject = subject;
        this.data = [
            {
                client_id: clientId,
                clientId,
                keyId: clientId,
                client_secret: clientSecret,
                clientSecret,
                name,
                subject,
            },
        ];
    }
}

/**
 * The response of retiring a key.
 */
export class DeleteKeyResponseDTO extends BasicResponseDTO {
    client_id: string;

    clientId: string;

    keyId: string;

    subject: string;

    data: Array<Record<string, unknown>>;

    constructor({ message, clientId, subject }: { message: string; clientId: string; subject: string }) {
        super();
        this.message = message;
        this.client_id = clientId;
        this.clientId = clientId;
        this.keyId = clientId;
        this.subject = subject;
        this.data = [{ client_id: clientId, clientId, keyId: clientId, subject }];
    }
}
