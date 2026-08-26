import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Environment } from './Environment.js';

/**
 * The request body used to move a user between the environments their account holds
 */
export class UpdateEnvironmentDto {
    /**
     * The environment to use for the user
     * <br><br>
     * Example `"sandbox"`
     * @example "sandbox"
     */
    @ApiProperty({ enum: Environment, example: Environment.SANDBOX })
    @IsOptional()
    @IsEnum(Environment)
    public environment?: Environment;

    /**
     * The subject to use for the user
     * <br><br>
     * Example `"auth0|5f9a7a7a7a7a7a7a7a7a7a7a"`
     * @example "auth0|5f9a7a7a7a7a7a7a7a7a7a7a"
     */
    @ApiProperty({ type: String, example: 'auth0|5f9a7a7a7a7a7a7a7a7a7a7a' })
    @IsOptional()
    @IsString()
    public userSubject: string;
}
