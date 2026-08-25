import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { SendInvoiceEmail } from './update-settings.dto';

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
    @IsOptional()
    @IsEmail()
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
    @ApiProperty()
    public sendInvoiceEmail?: SendInvoiceEmail;

    @IsOptional()
    @ApiHideProperty()
    public subject?: string;

    @IsString()
    @IsOptional()
    @ApiHideProperty()
    public vatId?: string;

    @IsString()
    @IsOptional()
    @ApiHideProperty()
    public customFields?: string;

    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     * @example 'My Cool Corp'
     **/
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * The URL to redirect to after relevant requests, such as completion of a connection.
     * <br><br>
     * Example: `"https://mybusiness.com/redirect"`
     * @example "https://mybusiness.com/redirect"
     */
    @IsString()
    @IsOptional()
    public redirectionUrl?: string;
}
