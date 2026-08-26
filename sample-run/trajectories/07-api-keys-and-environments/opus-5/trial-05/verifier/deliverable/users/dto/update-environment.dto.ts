import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { Environment } from './Environment.js';

/**
 * The environment which the caller wishes to work inside of.
 * <br><br>
 * The environment is a property of the person signed into the console, every request
 * which follows the update is resolved inside of the newly selected environment.
 */
export class UpdateEnvironmentDto {
    /**
     * The environment to use for the user
     * <br><br>
     * Example `"sandbox"`
     * @example "sandbox"
     */
    @IsEnum(Environment, {
        message: (args: ValidationArguments) => {
            const { value } = args;
            const correctValues = Object.values(Environment);
            return `environment: The value ${value} is not a valid value for the environment field. The correct values are: ${correctValues}`;
        },
    })
    @IsOptional()
    @ApiProperty({ enum: Environment, required: false })
    environment?: Environment;

    /**
     * The subject to use for the user
     * <br><br>
     * Example `"auth0|5f9a7a7a7a7a7a7a7a7a7a7a"`
     * @example "auth0|5f9a7a7a7a7a7a7a7a7a7a7a"
     */
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    @ApiProperty({ required: false })
    userSubject?: string;
}
