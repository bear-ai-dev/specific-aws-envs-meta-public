import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { SendInvoiceEmail } from './update-settings.dto.js';

/**
 * The field set of the business profile screen.
 * <br><br>
 * Every field is optional, a request only names the fields the person on the screen touched. Anything left out keeps
 * the value the business already had stored, anything named is written, even when the value sent is empty.
 */
export class UpdateProfileDto {
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
    @ApiProperty({ required: false })
    public sendInvoiceEmail?: SendInvoiceEmail;

    /**
     * The Name for the Business Entity using MeteringCo
     * <br><br>
     * Example: `"My Smart Business Name"`
     * @example "My Smart Business Name"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public businessName?: string;

    /**
     * Street number and name (address line 1)
     * <br><br>
     * Example: `"123 Success Street"`
     * @example "123 Success Street"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public addressLine1?: string;

    /**
     * Apartment or unit and its number (address line 2)
     * <br><br>
     * Example: `"Suite 100"`
     * @example "Suite 100"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public addressLine2?: string;

    /**
     * City of Business Entity's Location
     * <br><br>
     * Example: `"San Francisco"`
     * @example "San Francisco"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public city?: string;

    /**
     * State of Business Entity's Location
     * <br><br>
     * Example: `"CA"`
     * @example "CA"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public state?: string;

    /**
     * Country of Business Entity's Location
     * <br><br>
     * Example: `"USA"`
     * @example "USA"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public country?: string;

    /**
     * Postal code of Business Entity's Location
     * <br><br>
     * Example: `"94188"`
     * @example "94188"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public postalCode?: string;

    /**
     * Email address utilized by the Business Entity for customer support
     * <br><br>
     * Example: `"support@mybusiness.com"`
     * @example "support@mybusiness.com"
     */
    @IsEmail()
    @IsOptional()
    @ApiProperty({ required: false })
    public supportEmail?: string;

    /**
     * The URL to redirect to after relevant requests, such as completion of a connection.
     * <br><br>
     * Example: `"https://mybusiness.com/redirect"`
     * @example "https://mybusiness.com/redirect"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({ required: false })
    public redirectionUrl?: string;

    /**
     * The businessID associated with your account, this is gathered during authentication
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * The subject associated with the authenticated user
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public subject?: string;
}
