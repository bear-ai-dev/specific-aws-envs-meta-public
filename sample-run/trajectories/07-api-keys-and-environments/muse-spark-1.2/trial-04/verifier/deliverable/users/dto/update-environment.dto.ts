import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Environment } from './Environment.js';

export class UpdateEnvironmentDto {
    @ApiProperty({ enum: Environment, example: Environment.PRODUCTION })
    @IsEnum(Environment, {
        message: (args) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `environment: The value ${value} is not a valid value for the environment field. The correct values are: ${correctValues}`;
        },
    })
    environment: Environment;
}
