import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { SendInvoiceEmail } from './update-settings.dto.js';

export class UpdateProfileDto {
    @IsString()
    @IsOptional()
    public businessName?: string;

    @IsString()
    @IsOptional()
    public addressLine1?: string;

    @IsString()
    @IsOptional()
    public addressLine2?: string;

    @IsString()
    @IsOptional()
    public city?: string;

    @IsString()
    @IsOptional()
    public state?: string;

    @IsString()
    @IsOptional()
    public country?: string;

    @IsString()
    @IsOptional()
    public postalCode?: string;

    @IsOptional()
    @IsEmail()
    public supportEmail?: string;

    @IsEnum(SendInvoiceEmail, {
        message: (args) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `sendInvoiceEmail: The value ${value} is not a valid value for the sendInvoiceEmail field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty()
    public sendInvoiceEmail?: SendInvoiceEmail;

    @IsString()
    @IsOptional()
    public stripeAccountId?: string;

    @IsString()
    @IsOptional()
    public redirectionUrl?: string;

    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    @ApiHideProperty()
    @IsOptional()
    public subject?: string;
}
