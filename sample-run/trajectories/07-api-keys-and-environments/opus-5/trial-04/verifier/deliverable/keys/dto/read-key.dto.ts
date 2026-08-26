import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Environment } from '../../users/dto/Environment.js';

/**
 * A machine credential of the account, as it is shown on the API key screen. A listing never
 * carries a secret: a secret only ever exists in the response of the request which created it.
 */
export class KeyResponseDataDto {
    /**
     * The id of the credential at the identity provider, used to rotate or retire it
     * @example keyProductionIngest
     */
    @ApiProperty()
    public keyId: string;

    /**
     * The same id, under the name the identity provider uses for it
     * @example keyProductionIngest
     */
    @ApiProperty()
    public clientId: string;

    /**
     * The same id, under the name the identity provider uses for it
     * @example keyProductionIngest
     */
    @ApiProperty({ name: 'client_id' })
    public client_id: string;

    /**
     * The human readable name of the credential
     * @example Production ingest
     */
    @ApiProperty()
    public name: string;

    /**
     * The account the credential signs in as
     * @example keyProductionIngest@clients
     */
    @ApiProperty()
    public subject: string;

    /**
     * The account which holds the credential
     * @example myCoolCorp
     */
    @ApiProperty()
    public businessID: string;

    /**
     * The environment of the account which holds the credential
     * @example production
     */
    @ApiProperty({ enum: Environment })
    public environment: Environment;
}

export class ReadKeysResponseDto extends BasicResponseDTO {
    @ApiProperty({ type: [KeyResponseDataDto] })
    public data: Array<KeyResponseDataDto>;
}

/**
 * The response of a rotation. It carries the fresh secret, which the identity provider will not
 * show again, alongside the credential it belongs to.
 */
export class RotatedKeyDataDto extends KeyResponseDataDto {
    /**
     * The freshly minted secret of the credential
     */
    @ApiProperty()
    public clientSecret: string;

    /**
     * The freshly minted secret of the credential
     */
    @ApiProperty({ name: 'client_secret' })
    public client_secret: string;
}

export class RotateKeyResponseDto extends BasicResponseDTO {
    @ApiProperty({ type: [RotatedKeyDataDto] })
    public data: Array<RotatedKeyDataDto>;

    /**
     * The freshly minted secret of the credential
     */
    @ApiProperty()
    public clientSecret: string;

    /**
     * The freshly minted secret of the credential
     */
    @ApiProperty({ name: 'client_secret' })
    public client_secret: string;
}
