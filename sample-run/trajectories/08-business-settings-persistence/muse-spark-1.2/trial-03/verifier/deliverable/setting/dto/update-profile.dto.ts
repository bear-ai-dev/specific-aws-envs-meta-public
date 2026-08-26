import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString } from 'class-validator';
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

    @IsEnum(SendInvoiceEmail, {
        message: (args) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `sendInvoiceEmail: The value ${value} is not a valid value for the sendInvoiceEmail field. The correct values are: ${correctValues}`;
        },
    })
    @IsOptional()
    @ApiProperty({ required: false, enum: SendInvoiceEmail })
    public sendInvoiceEmail?: SendInvoiceEmail;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public logoUrl?: string;

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
    public redirectionUrl?: string;

    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public stripeAccountId?: string;

    // Allow any other settings field to be sent via profile as well, behaving same merge
    // This keeps flexibility for trading details screen that may send subset
    @IsOptional()
    public businessID?: string;

    @IsOptional()
    public subject?: string;
}
