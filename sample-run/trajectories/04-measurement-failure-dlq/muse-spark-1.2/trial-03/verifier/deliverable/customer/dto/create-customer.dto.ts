import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import {
    IsArray,
    IsEmail,
    IsEnum,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsRFC3339,
    IsString,
    IsUUID,
    Validate,
    ValidateNested,
    ValidationArguments,
} from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { Type } from 'class-transformer';
import { CustomCountryCodeValidator } from './customCountryCodeValidator.js';
import { OfferingIdExists } from '../../offering/dto/offeringIdExists.js';
import { TaxExempt } from './TaxExempt.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';
import { ValidatePastDate } from './validatePastDate.js';
import { UsageForCustomerEnrollment } from '../../usage/dto/create-usage.dto.js';
import { ValidateUniqueDimensions } from './hasNonOverlappingDimensions.js';

export class Address {
    /**
     * Two-letter country code
     * <br><br>
     * Example: <br>
     * - `'US'`<br>
     * - `'DE'`<br>
     *
     * @example 'US'
     */
    @IsNotEmpty()
    @IsString()
    @Validate(CustomCountryCodeValidator)
    @ApiProperty()
    public countryCode: string;

    /**
     * The postal code of the address. Typically, this is the country-specific.
     * <br><br>
     * Example: `"90210"`
     *
     * @example "90210"
     */
    @IsNotEmpty()
    @IsString()
    @ApiProperty()
    public postalCode: string;

    /**
     * The city of the address
     * <br><br>
     * Example: `"Beverly Hills"`
     * @example "Beverly Hills"
     **/
    @IsNotEmpty()
    @IsString()
    @ApiProperty()
    public city: string;

    /**
     * The first line of the street address
     * <br><br>
     * Example: `"1234 Main St"`
     * @example "1234 Main St"
     * */
    @IsNotEmpty()
    @IsString()
    @ApiProperty()
    public streetLineOne: string;

    /**
     * The second line of the street address
     * <br><br>
     * Example: `"Apt 1"`
     * @example "Apt 1"
     * */
    @IsOptional()
    @IsString()
    @ApiProperty()
    public streetLineTwo?: string;

    /**
     * Two-letter state code
     * <br><br>
     * Example: <br>
     * - `'NY'`
     * - `'CA'`
     *
     * @example "NY"
     */
    @IsNotEmpty()
    @IsString()
    @ApiProperty()
    public state: string;
}

export enum paymentChannel {
    /**
     * Stripe as the payment channel
     */
    Stripe = 'Stripe',
    /**
     * Deprecated
     */
    manual = 'manual',
}
/**
 * Stripe payment channel options
 * @example {"stripeCustomerId": "12345"}
 */
export class StripePaymentChannelOptions {
    /**
     * The unique identifier for the customer in Stripe
     * <br><br>
     * Example: `"cus_xxxxxxxxxxxxxx"`
     * */
    @IsOptional()
    stripeCustomerId?: string;
}
export class CreateCustomerDto {
    /**
     * Unique identifier for a customer. If one is not passed in MeteringCo will assign a unique UUID for the customer. If one is passed in and it already exists an error will be returned.
     *
     * Example: `"e345f409-daca-4144-91d2-0a0f87c96581"`
     * @example "e345f409-daca-4144-91d2-0a0f87c96581"
     */
    @IsString()
    @IsOptional()
    public customerId?: string;

    /**
     * The unique identifier for the offering associated with a customer
     * <br><br>
     * Example: `"eea7347bd-a2d8-4390-ae09-68f9b8e4ed6c"`
     * @example "eea7347bd-a2d8-4390-ae09-68f9b8e4ed6c"
     */
    @IsString()
    @IsUUID()
    @IsOptional()
    @OfferingIdExists('offeringId', {})
    public offeringId?: string;

    /**
     * The date time when the user was enrolled in the offering. If not set the current date time will be used.
     * Must be a valid RFC3339 date time string. Must be in the past UTC time.
     * <br><br>
     * Example: `"2020-01-01T00:00:00Z"`
     * @example "2020-01-01T00:00:00Z"
     */
    @IsString()
    @IsRFC3339()
    @IsOptional()
    @ValidatePastDate('offeringEnrollmentDate')
    public offeringEnrollmentDate?: string;

    /**
     * The friendly, human-readable name for the customer profile
     * <br><br>
     * Example: `"John Doe"`
     * @example "John Doe"
     */
    @IsString()
    @IsNotEmpty()
    public customerName: string;

    /**
     * The VAT ID of the customer.
     * Every VAT identification number must begin with the code of the country concerned and
     * followed by a block of digits or characters.
     * <br><br>
     * Example `"GB VAT 123456789"`
     *
     * @example "GB VAT 123456789"
     */
    @IsString()
    @IsOptional()
    public customerVatId?: string;

    /**
     * The customer's preferred currency. Only ISO 4217 currency codes are allowed. Overrides the currency on an offering. If not specified,
     * the currency on the offering will be used. If no currency is specified on the offering, the default currency of `"USD"` will be used.
     * <br><br>
     * Example `"USD"`
     * @example "USD"
     */
    @IsEnum(SupportedCurrencies, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `currency: The value ${value} is not a valid value for the currency field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty({ enum: SupportedCurrencies })
    public currency?: SupportedCurrencies;

    /**
     * Customer email address
     * <br><br>
     * Example: `"noreply@meteringco.example"`
     * @example "noreply@meteringco.example"
     */
    @IsEmail()
    @IsOptional()
    public email: string;

    /**
     * The payment channel associated with a customer
     * <br><br>
     * Example: `"Stripe"`
     * @example "Stripe"
     */
    @IsEnum(paymentChannel, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `paymentChannel: The value ${value} is not a valid value for the paymentChannel field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsNotEmpty()
    public paymentChannel: paymentChannel;

    /**
     * Whether the customer is exempt from paying taxes
     *  <br><br>
     * Example: `"none"`
     * @example "none"
     */
    @IsEnum(TaxExempt, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `taxExempt: The value ${value} is not a valid value for the taxExempt field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty({ default: TaxExempt.none })
    public taxExempt?: TaxExempt;

    /**
     * The unique identifier for the SaaS business
     * @example HarperDB
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * Configuration options for the payment channel.
     * For Stripe payment, `stripeCustomerId` is required for existing Stripe customers.
     * If `stripeCustomerId` is not provided, a new Stripe customer will be created.
     * See example below.
     * <br><br>
     * Example `{"stripeCustomerId": "cus_xxxxxxxxxxxxxx"}`
     */
    @IsObject()
    @IsOptional()
    public paymentChannelOptions?: StripePaymentChannelOptions;

    /**
     * The address of the customer
     */
    @ValidateNested({ each: true })
    @IsOptional()
    @Type(() => Address)
    public address?: Address;

    /**
     * An optional key-value map of additional metadata to associate with the customer.
     * such as environment, purpose, owner, developer, contract number,
     * or any arbitrary data to be associated with this usage record. Additionally, if `null` is passed for any value in the metadata object it will be removed.
     *  To entirely remove the metadata object, pass null to the metadata field.
     * <br><br>
     * Example `{"environment": "staging", "purpose": "proof-of-concept", "owner": "John Doe", "workspaceId": null}`
     * <br><br>
     * In the above example, the `workspaceId` metadata key will be removed from the dimension. To remove all fields pass the following.
     * <br><br>
     * Example `"metadata": null`
     **/
    @IsObject()
    @IsOptional()
    public metadata?: Record<string, string | number | null>;

    /**
     * Optionally, usage can be initally applied for a customer when they are enrolling in an offering.
     * This is used for dimensions which have a paymentSchedule of `upfront` and need to have some usage for the intial enrollment.
     * For example, a customer purchases 3 seats then on the enrollment a usage `recordValue` of 3 must be sent in for the time of purchase.
     * Multiple usage records can be sent in, regardless of dimension. If usage records are sent in for a dimension that is not on the current offering, they will be loaded into meteringco,
     * but ignored on the invoice.
     * <br><br>
     * Example: `[{ "dimensionId": "539b7f74-3832-474e-a955-6d69c5df12d0", "customerId":"f918b6f4-2ad6-48c4-8b62-ac23adada9ae", "recordValue": 3, timestamp: "2021-01-01T00:00:00Z" }]`
     * @example [{ "dimensionId": "539b7f74-3832-474e-a955-6d69c5df12d0", "customerId":"f918b6f4-2ad6-48c4-8b62-ac23adada9ae", "recordValue": 3, timestamp: "2021-01-01T00:00:00Z" }]
     */
    @IsArray()
    @ValidateUniqueDimensions('usage')
    @IsOptional()
    public usage?: UsageForCustomerEnrollment[];
}

export class CreateCustomerResponseDto extends BasicResponseDTO {
    /**
     * The unique identifier assigned by MeteringCo
     * <br><br>
     * Example: `"e345f409-daca-4144-91d2-0a0f87c96581"`
     * @example e345f409-daca-4144-91d2-0a0f87c96581
     */
    public customerId: string;

    /**
     * URL to a short-lived Stripe hosted portal session.
     * Customers can be redirected to this URL to enter payment information.
     * Example: `"https://billing.meteringco.example/stripe-portal?customerId=cus_xxxxxxxxxxxxxx"`
     * @example "https://billing.meteringco.example/stripe-portal?customerId=cus_xxxxxxxxxxxxxx"
     */
    public portalUrl?: string;
}
