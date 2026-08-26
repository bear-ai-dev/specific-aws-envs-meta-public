import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { KeyEntity } from '../entities/key.entity.js';
import { Environment } from './Environment.js';

/**
 * A machine to machine credential, (an API Key), which an account holds within an
 * environment.
 */
export class ReadKeyResponseData {
    /**
     * The identifier of the credential, used to rotate or delete it
     * @example aabbbcbaksjdhka
     */
    public keyId: string;

    /**
     * The identifier of the credential at the identity provider
     * @example aabbbcbaksjdhka
     */
    public client_id: string;

    /**
     * The identifier of the credential at the identity provider
     * @example aabbbcbaksjdhka
     */
    public clientId: string;

    /**
     * A human readable name for the credential
     * @example My integration
     */
    public name: string;

    /**
     * The subject which the credential signs in as
     * @example aabbbcbaksjdhka@clients
     */
    public subject: string;

    /**
     * The account which holds the credential
     * @example myCoolCorp
     */
    public businessID: string;

    /**
     * The environment of the account which holds the credential
     * @example production
     */
    @ApiProperty({ enum: Environment })
    public environment: Environment;

    /**
     * The secret of the credential. Only ever returned directly after the secret has
     * been rotated, the identity provider will never disclose it again.
     */
    public client_secret?: string;

    /**
     * The secret of the credential. Only ever returned directly after the secret has
     * been rotated, the identity provider will never disclose it again.
     */
    public clientSecret?: string;

    public static fromEntity(entity: KeyEntity): ReadKeyResponseData {
        const data = new ReadKeyResponseData();
        data.keyId = entity.keyId;
        data.client_id = entity.keyId;
        data.clientId = entity.keyId;
        data.name = entity.name;
        data.subject = entity.subject;
        data.businessID = entity.businessID;
        data.environment = entity.environment;
        if (entity.clientSecret) {
            data.client_secret = entity.clientSecret;
            data.clientSecret = entity.clientSecret;
        }
        return data;
    }
}

/**
 * The credentials which the account holds in the environment the caller is currently
 * operating within.
 */
export class ReadKeysResponseDto extends BasicResponseDTO {
    public data: Array<ReadKeyResponseData>;
}

/**
 * The result of rotating the secret of a single credential.
 */
export class RotateKeyResponseDto extends BasicResponseDTO {
    public data: Array<ReadKeyResponseData>;

    /**
     * The newly generated secret of the credential
     */
    public client_secret?: string;

    /**
     * The newly generated secret of the credential
     */
    public clientSecret?: string;
}
