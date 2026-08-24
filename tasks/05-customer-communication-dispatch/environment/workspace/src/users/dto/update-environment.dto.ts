import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, ValidationArguments } from 'class-validator';
import { Environment } from './Environment.js';

export class UpdateEnvironmentDto {
    /**
     * The environment to use for the user
     * <br><br>
     * Example `"sandbox"`
     * @example "sandbox"
     */
    @IsEnum(Environment, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `environment: The value ${value} is not a valid value for the environment field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty({ enum: Environment })
    public environment?: Environment;

    /**
     * The subject to use for the user
     * <br><br>
     * Example `"auth0|5f9a7a7a7a7a7a7a7a7a7a7a"`
     * @example "auth0|5f9a7a7a7a7a7a7a7a7a7a7a"
     */
    @ApiProperty()
    @IsOptional()
    public userSubject: string;
}
