import { IsEnum, IsNotEmpty } from 'class-validator';
import { Environment } from './Environment.js';
import { ApiProperty } from '@nestjs/swagger';

export class SetEnvironmentDto {
    @ApiProperty({ enum: Environment, description: 'The environment to switch to' })
    @IsEnum(Environment, {
        message: (args) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `environment: The value ${value} is not a valid value for the environment field. The correct values are: ${correctValues}`;
        },
    })
    @IsNotEmpty()
    environment: Environment;
}
