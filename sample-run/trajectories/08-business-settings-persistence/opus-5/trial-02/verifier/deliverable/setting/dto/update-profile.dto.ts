import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { SendInvoiceEmail } from './update-settings.dto.js';

/**
 * The set of fields displayed on the business profile screen. <br>
 * All fields are optional, only the fields sent are written, everything else keeps its stored value.
 */
export class UpdateProfileDto {
    /**
     * The Name for the Business Entity using MeteringCo
     * <br><br>
     * Example: `"My Smart Business Name"`
     * @example "My Smart Business Name"
     */
    @IsString()
    @IsOptional()
    public businessName?: string;

    /**
     * Street number and name (address line 1)
     * <br><br>
     * Example: `"123 Success Street"`
     * @example "123 Success Street"
     */
    @IsString()
    @IsOptional()
    public addressLine1?: string;

    /**
     * Apartment or unit and its number (address line 2)
     * <br><br>
     * Example: `"Suite 100"`
     * @example "Suite 100"
     */
    @IsString()
    @IsOptional()
    public addressLine2?: string;

    /**
     * City of Business Entity's Location
     * <br><br>
     * Example: `"San Francisco"`
     * @example "San Francisco"
     */
    @IsString()
    @IsOptional()
    public city?: string;

    /**
     * State of Business Entity's Location
     * <br><br>
     * Example: `"CA"`
     * @example "CA"
     */
    @IsString()
    @IsOptional()
    public state?: string;

    /**
     * Country of Business Entity's Location
     * <br><br>
     * Example: `"USA"`
     * @example "USA"
     */
    @IsString()
    @IsOptional()
    public country?: string;

    /**
     * Postal code of Business Entity's Location
     * <br><br>
     * Example: `"94188"`
     * @example "94188"
     */
    @IsString()
    @IsOptional()
    public postalCode?: string;

    /**
     * Email address utilized by the Business Entity for customer support
     * <br><br>
     * Example: `"support@mybusiness.com"`
     * @example "support@mybusiness.com"
     */
    @IsEmail()
    @IsOptional()
    public supportEmail?: string;

    /**
     * Whether MeteringCo should send invoices to customers.
     * <br><br>
     * Example: `"true"`
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
     * The Stripe Account ID for the Business Entity.
     * <br><br>
     * Example: `"acct_1J2k3l4m5n6o7p8q9r0s"`
     * @example "acct_1J2k3l4m5n6o7p8q9r0s"
     */
    @IsString()
    @IsOptional()
    public stripeAccountId?: string;

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
