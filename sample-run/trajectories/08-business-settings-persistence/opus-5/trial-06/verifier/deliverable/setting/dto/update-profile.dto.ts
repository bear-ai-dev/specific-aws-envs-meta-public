import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { SendInvoiceEmail } from './SendInvoiceEmail.js';

/**
 * The set of fields shown, and editable, on the business profile screen. They are all optional and are
 * saved over the same settings document as every other setting, only the fields sent are written, any
 * field which is not sent keeps the value the business already had stored.
 */
export class UpdateProfileDto {
    /**
     * The Name for the Business Entity using MeteringCo
     * @example "My Smart Business Name"
     */
    @IsString()
    @IsOptional()
    public businessName?: string;

    /**
     * Street number and name (address line 1)
     * @example "123 Success Street"
     */
    @IsString()
    @IsOptional()
    public addressLine1?: string;

    /**
     * Apartment or unit and its number (address line 2)
     * @example "Suite 100"
     */
    @IsString()
    @IsOptional()
    public addressLine2?: string;

    /**
     * City of Business Entity's Location
     * @example "San Francisco"
     */
    @IsString()
    @IsOptional()
    public city?: string;

    /**
     * State of Business Entity's Location
     * @example "CA"
     */
    @IsString()
    @IsOptional()
    public state?: string;

    /**
     * Country of Business Entity's Location
     * @example "USA"
     */
    @IsString()
    @IsOptional()
    public country?: string;

    /**
     * Postal code of Business Entity's Location
     * @example "94188"
     */
    @IsString()
    @IsOptional()
    public postalCode?: string;

    /**
     * Email address utilized by the Business Entity for customer support
     * @example "support@mybusiness.com"
     */
    @IsEmail()
    @IsOptional()
    public supportEmail?: string;

    /**
     * Whether MeteringCo should send invoices to customers.
     * @example "true"
     */
    @IsEnum(SendInvoiceEmail, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `sendInvoiceEmail: The value ${value} is not a valid value for the sendInvoiceEmail field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty({ enum: SendInvoiceEmail, required: false })
    public sendInvoiceEmail?: SendInvoiceEmail;

    /**
     * A URL to redirect to after relevant connection, or payment actions.
     */
    @IsString()
    @IsOptional()
    public redirectionUrl?: string;

    /**
     * The businessID associated with your account, this is gathered during authentication
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    @ApiHideProperty()
    @IsOptional()
    public subject?: string;
}
