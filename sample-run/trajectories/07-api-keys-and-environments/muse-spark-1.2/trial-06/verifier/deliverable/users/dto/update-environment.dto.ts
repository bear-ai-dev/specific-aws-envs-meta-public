import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Environment } from './Environment.js';

export class UpdateEnvironmentDto {
    @ApiProperty({ enum: Environment })
    @IsEnum(Environment, {
        message: 'environment must be one of the following values: production, sandbox',
    })
    environment: Environment;

    @ApiProperty({ required: false })
    @IsString()
    @IsOptional()
    userSubject?: string;
}
