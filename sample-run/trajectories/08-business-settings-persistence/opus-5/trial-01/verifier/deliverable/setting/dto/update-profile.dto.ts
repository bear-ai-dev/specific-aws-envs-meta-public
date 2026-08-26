import { ApiHideProperty, PickType } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { UpdateSettingsDto } from './update-settings.dto.js';

/**
 * The field set of the business profile screen.
 * <br><br>
 * Every field is optional. Only the fields sent in are written over the business' stored
 * configuration, any field left out keeps the value the business already had stored, and any field
 * sent in is written even when the value sent in is empty.
 */
export class UpdateProfileDto extends PickType(UpdateSettingsDto, ['sendInvoiceEmail'] as const) {
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
     * The URL to redirect to after relevant requests, such as completion of a connection.
     * <br><br>
     * Example: `"https://mybusiness.com/redirect"`
     * @example "https://mybusiness.com/redirect"
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

    /**
     * The subject associated with the user, this is gathered during authentication
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public subject?: string;
}
