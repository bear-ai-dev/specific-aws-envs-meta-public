import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { Environment } from './Environment.js';

/**
 * Used to change which environment a user is currently operating within.
 * <br><br>
 * The environment which is chosen dictates the account (businessID) which the
 * requests made by the user resolve to, and therefore the data which is
 * reachable by that user.
 */
export class UpdateEnvironmentDto {
    /**
     * The environment to use for the user
     * <br><br>
     * Example `"sandbox"`
     * @example "sandbox"
     */
    @ApiProperty({ enum: Environment, default: Environment.PRODUCTION })
    @IsEnum(Environment, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `environment: The value ${value} is not a valid value for the environment field. The correct values are: ${correctValues}`;
        },
    })
    @IsOptional()
    public environment?: Environment;

    /**
     * The subject to use for the user
     * <br><br>
     * Example `"auth0|5f9a7a7a7a7a7a7a7a7a7a7a"`
     * @example "auth0|5f9a7a7a7a7a7a7a7a7a7a7a"
     */
    @IsString()
    @IsOptional()
    public userSubject: string;
}
