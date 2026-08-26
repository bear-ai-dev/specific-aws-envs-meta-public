import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { Environment } from './Environment.js';

/**
 * The request body used to move a caller between the environments their account holds
 */
export class UpdateEnvironmentDto {
    /**
     * The environment which should be used for every request made after this one
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
    @IsNotEmpty()
    @ApiProperty({ enum: Environment })
    public environment: Environment;

    /**
     * The subject whose environment should be changed. Only honored on the administrative route,
     * on the regular route the environment of the caller is always the one which is changed.
     * @example auth0|abc123
     */
    @IsString()
    @IsOptional()
    public subject?: string;
}
