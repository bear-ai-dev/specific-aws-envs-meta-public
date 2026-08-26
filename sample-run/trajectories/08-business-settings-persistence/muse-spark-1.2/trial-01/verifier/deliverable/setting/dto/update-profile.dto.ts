import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsEmail, IsEnum } from 'class-validator';
import { SendInvoiceEmail } from './update-settings.dto.js';

export class UpdateProfileDto {
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public businessName?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public addressLine1?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public addressLine2?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public city?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public state?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public country?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public postalCode?: string;

    @IsEmail()
    @IsOptional()
    @ApiProperty({ required: false })
    public supportEmail?: string;

    @IsEnum(SendInvoiceEmail)
    @IsOptional()
    @ApiProperty({ required: false, enum: SendInvoiceEmail })
    public sendInvoiceEmail?: SendInvoiceEmail;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public stripeAccountId?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public redirectionUrl?: string;
}
