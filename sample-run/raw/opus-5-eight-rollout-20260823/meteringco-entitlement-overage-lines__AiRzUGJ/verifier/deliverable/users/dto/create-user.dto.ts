import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { Environment } from './Environment.js';

export class CreateUserDto {
    /**
     *The subject associated with the jwt token on the authentication request
     * with Auth0 this is returned in the payload after the authentication process occurs
     * It is apart of the JWT specification and must be globally unique and associated with the JWT bearer
     * @example aabbbcbaksjdhka@clients
     */
    @IsString()
    @IsNotEmpty()
    subject: string;
    /**
     * The business enitity which the subject is tied to, multiple subjects can have the same businessID
     * @example myCoolCorp
     */
    @IsString()
    @IsNotEmpty()
    businessID: string;

    /**
     * The environment which the account is associated with, defaults to production
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
    environment?: Environment;

    /**
     * If the account is considered a temporary account or not, defaults to false
     * @example true
     */
    @IsBoolean()
    @IsOptional()
    temp?: boolean;

    /**
     * The assocaited stripe account with the user if relevant.
     * @example ac_itkjsadf1
     */
    @IsString()
    @IsOptional()
    stripeAccountID?: string;
    /**
     * The date when the account will expire. After this date, MeteringCo will soft delete the information associated with the account
     * @example 2019-09-07T-15:50+00
     */
    @IsISO8601()
    @IsOptional()
    accountExpiryDate?: string;
}
