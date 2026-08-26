import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Environment } from './Environment.js';

/**
 * A machine credential (API key) which belongs to a single environment of a single account.
 */
export class ReadKeyDTO {
    /**
     * The identifier of the key at the identity provider, used to address the key on the API
     * @example "aabbbcbaksjdhka"
     */
    @ApiProperty()
    public keyId: string;

    /**
     * Alias of the keyId, matching the naming used by the identity provider
     */
    @ApiProperty()
    public client_id: string;

    /**
     * Alias of the keyId, camel cased for convenience of the dashboard
     */
    @ApiProperty()
    public clientId: string;

    /**
     * The human readable name given to the key
     */
    @ApiProperty()
    public name: string;

    /**
     * The subject which is presented inside of the tokens minted with this key
     * @example "aabbbcbaksjdhka@clients"
     */
    @ApiProperty()
    public subject: string;

    /**
     * The account which the key is able to read and write
     */
    @ApiProperty()
    public businessID: string;

    /**
     * The environment which the key belongs to
     */
    @ApiProperty({ enum: Environment })
    public environment: Environment;

    /**
     * The type of application registered at the identity provider
     */
    @ApiProperty({ required: false })
    public app_type?: string;

    /**
     * Only ever populated on a rotation, never on a listing
     */
    @ApiProperty({ required: false })
    public client_secret?: string;
}

export class ReadKeysResponseDTO extends BasicResponseDTO {
    @ApiProperty({ type: [ReadKeyDTO] })
    public data: Array<ReadKeyDTO>;
}
