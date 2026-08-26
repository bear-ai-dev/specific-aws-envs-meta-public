import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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

    @IsOptional()
    @IsEmail()
    @ApiProperty({ required: false })
    public supportEmail?: string;

    @IsOptional()
    @IsEnum(SendInvoiceEmail, {
        message: (args) => {
            const { value, constraints } = args as any;
            const correctValues = Object.values(constraints[0]);
            return `sendInvoiceEmail: The value ${value} is not a valid value for the sendInvoiceEmail field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
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

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public logoUrl?: string;

    @IsOptional()
    @IsString()
    public businessID?: string;

    @IsOptional()
    @IsString()
    public subject?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public taxRate?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public vatId?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public invoicePaymentTerm?: string;
}
