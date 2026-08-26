import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Environment } from '../../users/dto/Environment.js';
import { KeyEntity } from '../entities/key.entity.js';

/**
 * A machine credential (API key) held by the account in one environment
 */
export class KeyDto {
    /**
     * The identifier of the key
     * <br><br>
     * Example `"3v4kZ1Q9Xw"`
     * @example "3v4kZ1Q9Xw"
     */
    public keyId: string;

    /**
     * The identifier of the key, as the identity provider names it
     * <br><br>
     * Example `"3v4kZ1Q9Xw"`
     * @example "3v4kZ1Q9Xw"
     */
    public clientId: string;

    /**
     * The identifier of the key, as the identity provider names it
     * <br><br>
     * Example `"3v4kZ1Q9Xw"`
     * @example "3v4kZ1Q9Xw"
     */
    public client_id: string;

    /**
     * The account the key signs in as
     * <br><br>
     * Example `"3v4kZ1Q9Xw@clients"`
     * @example "3v4kZ1Q9Xw@clients"
     */
    public subject: string;

    /**
     * The human readable name of the key
     * <br><br>
     * Example `"Production ingest"`
     * @example "Production ingest"
     */
    public name: string;

    /**
     * The account the key belongs to
     * <br><br>
     * Example `"acme-production"`
     * @example "acme-production"
     */
    public businessID: string;

    /**
     * The environment of the account the key belongs to
     */
    @ApiProperty({ enum: Environment, default: Environment.PRODUCTION })
    public environment: Environment;

    constructor(entity: KeyEntity) {
        this.keyId = entity.keyId;
        this.clientId = entity.keyId;
        this.client_id = entity.keyId;
        this.subject = entity.subject;
        this.name = entity.name;
        this.businessID = entity.businessID;
        this.environment = entity.environment;
    }

    public static fromEntity(entity: KeyEntity): KeyDto {
        return new KeyDto(entity);
    }
}

/**
 * All of the keys the account holds in the current environment
 */
export class ReadKeysResponseDto extends BasicResponseDTO {
    /**
     * The keys held by the account in the current environment
     */
    public data: KeyDto[];

    /**
     * The keys held by the account in the current environment
     */
    public keys: KeyDto[];

    constructor({ message, data }: { message: string; data: KeyDto[] }) {
        super();
        this.message = message;
        this.data = data;
        this.keys = data;
    }
}

/**
 * The freshly minted secret for a key, shown once at rotation time
 */
export class RotateKeyResponseDto extends BasicResponseDTO {
    public keyId: string;

    public clientId: string;

    public client_id: string;

    /**
     * The new secret for the key. It replaces the previous secret, which is
     * refused from this point onwards.
     */
    public clientSecret: string;

    /**
     * The new secret for the key. It replaces the previous secret, which is
     * refused from this point onwards.
     */
    public client_secret: string;

    public data: KeyDto[];

    constructor({ message, entity }: { message: string; entity: KeyEntity }) {
        super();
        this.message = message;
        this.keyId = entity.keyId;
        this.clientId = entity.keyId;
        this.client_id = entity.keyId;
        this.clientSecret = entity.clientSecret;
        this.client_secret = entity.clientSecret;
        this.data = [KeyDto.fromEntity(entity)];
    }
}

/**
 * The outcome of retiring a key
 */
export class DeleteKeyResponseDto extends BasicResponseDTO {
    public keyId: string;

    public clientId: string;

    public client_id: string;

    constructor({ message, keyId }: { message: string; keyId: string }) {
        super();
        this.message = message;
        this.keyId = keyId;
        this.clientId = keyId;
        this.client_id = keyId;
    }
}
