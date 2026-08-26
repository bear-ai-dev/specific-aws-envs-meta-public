import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Environment } from './Environment.js';

export class UpdateEnvironmentDto {
    @ApiProperty({ enum: Environment, example: 'sandbox' })
    @IsEnum(Environment)
    environment: Environment;

    @ApiProperty({ example: 'auth0|5f9a7a7a7a7a7a7a7a7a7a7a', required: false })
    @IsString()
    @IsOptional()
    userSubject?: string;
}
