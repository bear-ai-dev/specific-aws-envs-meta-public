import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Environment } from './Environment.js';

/**
 * A machine credential (an API key) which the account holds in the environment
 * the caller is currently in.
 */
export class ReadKeyDTO {
    /**
     * The id of the credential at the identity provider
     * @example "myCoolIntegrationClientId"
     */
    @ApiProperty()
    public client_id: string;

    /**
     * The id of the credential at the identity provider
     * @example "myCoolIntegrationClientId"
     */
    @ApiProperty()
    public clientId: string;

    /**
     * The id of the credential at the identity provider
     * @example "myCoolIntegrationClientId"
     */
    @ApiProperty()
    public keyId: string;

    /**
     * The human readable name of the credential
     * @example "My cool integration"
     */
    @ApiProperty()
    public name: string;

    /**
     * The subject the credential signs in as
     * @example "myCoolIntegrationClientId@clients"
     */
    @ApiProperty()
    public subject: string;

    /**
     * The account which holds the credential
     * @example "myCoolCorp"
     */
    @ApiProperty()
    public businessID: string;

    /**
     * The environment of the account which holds the credential
     * @example "production"
     */
    @ApiProperty({ enum: Environment })
    public environment: Environment;
}

/**
 * The response for reading all of the keys an account holds
 */
export class ReadKeysResponseDTO extends BasicResponseDTO {
    @ApiProperty({ type: [ReadKeyDTO] })
    public data: Array<ReadKeyDTO>;
}

/**
 * The response for rotating the secret of a single key. The secret is only
 * ever readable at the moment it is created, so it is returned here.
 */
export class RotateKeyResponseDTO extends BasicResponseDTO {
    @ApiProperty()
    public client_id: string;

    @ApiProperty()
    public clientId: string;

    @ApiProperty()
    public keyId: string;

    @ApiProperty()
    public client_secret: string;

    @ApiProperty()
    public clientSecret: string;

    @ApiProperty()
    public secret: string;

    @ApiProperty()
    public name: string;

    @ApiProperty({ type: [Object] })
    public data: Array<Record<string, unknown>>;
}

/**
 * The response for retiring a key for good
 */
export class DeleteKeyResponseDTO extends BasicResponseDTO {
    @ApiProperty()
    public client_id: string;

    @ApiProperty()
    public clientId: string;

    @ApiProperty()
    public keyId: string;
}
