import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Environment } from './Environment.js';

/**
 * A machine credential (API key) held by an account in a single environment
 */
export class ReadKeyDTO {
    /**
     * The identifier of the machine credential
     */
    @ApiProperty({ type: String })
    public keyId: string;

    /**
     * The identifier of the machine credential
     */
    @ApiProperty({ type: String })
    public clientId: string;

    /**
     * The identifier of the machine credential, as the identity provider names it
     */
    @ApiProperty({ type: String })
    public client_id: string;

    /**
     * The human readable name of the machine credential
     */
    @ApiProperty({ type: String })
    public name: string;

    /**
     * The human readable name of the machine credential
     */
    @ApiProperty({ type: String })
    public clientName: string;

    /**
     * The subject the machine credential signs in as
     */
    @ApiProperty({ type: String })
    public subject: string;

    /**
     * The account the machine credential belongs to
     */
    @ApiProperty({ type: String })
    public businessID: string;

    /**
     * The environment the machine credential belongs to
     */
    @ApiProperty({ enum: Environment })
    public environment: Environment;
}

/**
 * The response returned when listing the machine credentials of an account
 */
export class ReadKeysResponseDTO extends BasicResponseDTO {
    @ApiProperty({ type: [ReadKeyDTO] })
    public data: Array<ReadKeyDTO>;

    @ApiProperty({ type: [ReadKeyDTO] })
    public keys: Array<ReadKeyDTO>;

    @ApiProperty({ type: Number })
    public total: number;
}
