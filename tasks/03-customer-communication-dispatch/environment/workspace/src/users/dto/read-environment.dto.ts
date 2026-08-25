import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Environment } from './Environment.js';

/**
 * The response for the read environment contains the environment and the user
 */
export class ReadEnvionmentResponse extends BasicResponseDTO {
    /**
     * The environment to use for the user
     * <br><br>
     * Example `"sandbox"`
     * @example "sandbox"
     */
    @ApiProperty({ enum: Environment, default: Environment.PRODUCTION })
    public environment: Environment;

    public subject: string;

    constructor({ subject, environment }: { subject: string; environment: Environment }) {
        super();
        this.environment = environment;
        this.subject = subject;
    }
}

/**
 * The response for the read environment contains the environment and the user
 */
export class ReadBusinessEnvionmentResponse extends BasicResponseDTO {
    /**
     * The environment to use for the user
     * <br><br>
     * Example `"sandbox"`
     * @example "sandbox"
     */
    @ApiProperty({ enum: Environment, default: Environment.PRODUCTION })
    public environment: Environment;

    public businessID: string;

    constructor({ businessID, environment }: { businessID: string; environment: Environment }) {
        super();
        this.environment = environment;
        this.businessID = businessID;
    }
}
