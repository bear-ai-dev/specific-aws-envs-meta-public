import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

import {
    IsArray,
    IsEnum,
    IsNotEmpty,
    IsNumberString,
    IsObject,
    IsOptional,
    IsString,
    Validate,
    ValidationArguments,
} from 'class-validator';

import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { OfferingPackageEntity } from '../entities/offeringPackage.entity.js';
import { OfferingType } from '../entities/OfferingType.js';
import {
    IsNumericStringGreaterThanOrEqualToZeroValidator,
    IsNumericStringGreaterToZeroValidator,
} from '../../utils/validator.js';
import { SupportedOfferingCurrency, SupportedOfferingCurrencyEnum } from './SupportedCurrencies.js';
import { FreeTrialAndCredit } from './freeCreditFreeTrialLength.js';
import { ValidateDecimalPlace } from '../../dimensions/dto/validateDecimalPlaces.js';
import { CustomOverrides } from '../../contract/dto/prepareContractResponse.dto.js';
import { DimensionOverridesDto } from '../../contract/dto/dimensionOverrides.dto.js';

export enum OfferingVisibility {
    private = 'private',
    public = 'public',
}

export enum ValidBillingCycles {
    monthly = 'monthly',
    'annualToDate' = 'annualToDate',
}
/**
 * The Create offering object enables a MeteringCo Client to create an new offering in the MeteringCo System.
 * This can correspond to a pricing tier, a subscription, a flat rate, or pure-usage based
 *
 *
 */
export class CreateOfferingDTO {
    /**
     *
     * The visibility of the offering, specifically if its private or public.
     * Public offerings are designed to be shared among customers.
     * Private offerings are typically used for enterprise deals which contain discounts or prepaid credits.
     * <br><br>
     * Example: `"private"`
     * @example "private"
     * **/
    @IsEnum(OfferingVisibility)
    @IsNotEmpty()
    @IsOptional()
    @ApiProperty({ enum: OfferingVisibility, default: OfferingVisibility.public })
    public offeringVisibility?: OfferingVisibility;

    /**
     * Prepaid credit amount to be deducted as part of the bill payments. Only numerical string is allowed.
     * <br><br>Example: `"20.00"` for $20.00.
     * @example "20.00"
     *
     */
    @IsNumberString()
    @IsOptional()
    @Validate(IsNumericStringGreaterThanOrEqualToZeroValidator)
    public prepaidCredit?: string;

    /**
     * A minimum charge to be billed to the customer in the event that the customer's bill is less than the minimum charge. Only on usage based offerings. Only numerical strings are allowed, must be greater than zero.
     * <br><br>Example: `"32.00"` for $32.00.
     * @example "32.00"
     */
    @IsNumberString()
    @IsOptional()
    @Validate(IsNumericStringGreaterToZeroValidator)
    public minimumCharge?: string | null;

    /**
     * The type of offering.
     * <br>  • `usage-based` - The offering is a pure usage-based offering, or pay-as-you-go. Customers on this plan will be billed precisely based on consumption.
     * <br>  • `subscription` - The offering is a fixed subscription. Customer will be billed on a fixed price.
     *
     * Example `"subscription"`
     */
    @IsEnum(OfferingType)
    @IsNotEmpty()
    @IsOptional()
    @ApiProperty({
        enum: OfferingType,
        default: OfferingType.usageBased,
        example: OfferingType.subscription,
        externalDocs: {
            description: 'Read more about the different offering types',
            url: 'https://docs.meteringco.example/model-pricing-and-package/pricing-modeling-guide',
        },
    })
    public offeringType?: string;

    /**
     * The price of the subscription.
     * Only positive number string is allowed.
     * Only required if `offeringType` is `subscription`.
     * <br><br>
     *
     * Example: `20.00` for $20.00.
     * @example "20.00"
     */
    @IsOptional()
    @IsNumberString()
    @Validate(IsNumericStringGreaterThanOrEqualToZeroValidator)
    @ValidateDecimalPlace('subscriptionPrice')
    public subscriptionPrice?: number;

    /**
     * The length of time for a free trial. This is a number of days.
     * Only positive number string is allowed.
     * <br><br>
     *
     * Example: `"1"` for 1 day or 1 billing cycle depending on the offeringType.
     * @example "1"
     */
    @IsOptional()
    @IsNumberString()
    @Validate(IsNumericStringGreaterThanOrEqualToZeroValidator)
    @FreeTrialAndCredit('freeTrialLength')
    public freeTrialLength?: string;

    /**
     * The time frame when an automatic bill should be sent leave empty for no automated billing
     * <br><br>
     *
     * Example `"monthly"`
     * @example "monthly"
     */
    @IsEnum(ValidBillingCycles)
    @IsOptional()
    @ApiProperty({ enum: ValidBillingCycles, default: ValidBillingCycles.monthly })
    public billingCycle?: ValidBillingCycles;

    /**
     * A friendly, human-readable name for the offering.
     * <br><br>
     * Example `"Entperise Plan"`
     * @example "Entperise Plan"
     */
    @IsString()
    @IsNotEmpty()
    public offeringName: string;

    /**
     * The supported currency for the offering. USD is currently supported. Customers can override the currency for their account.
     * However all offerings are denoted in USD.
     * <br><br>
     * Example `"USD"`
     * @example "USD"
     */
    @IsEnum(SupportedOfferingCurrencyEnum, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `currency: The value ${value} is not a valid value for the currency field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty()
    public currency?: SupportedOfferingCurrency;

    /**
     * Array of the identifier of the dimensions that this offering contains. Dimensions specify the type of usage that is being billed for.
     * <br><br>
     * Example `["092f9444-851a-43fb-9503-2228dc01b1b", "4fcafdec-eeb9-4a7f-9caf-61387102b6fa"]`
     * @example ["092f9444-851a-43fb-9503-2228dc01b1b", "4fcafdec-eeb9-4a7f-9caf-61387102b6fa"]
     */
    @IsArray()
    @IsNotEmpty()
    @IsOptional()
    public dimensionIds?: Array<string>;

    /**
     * The Unique ID associated with your specific business account
     *
     * Example myCoolCorp
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * An optional key-value map of additional metadata to associate with the offerings.
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
     * Overrides for the offering. Applies specific overrides to the dimensions associated with the offering. These effect the price of each dimension on the offering.
     */
    @IsOptional()
    @ApiProperty({ type: DimensionOverridesDto, required: false, isArray: true })
    public dimensionOverrides?: DimensionOverridesDto[];

    constructor(entity: OfferingPackageEntity) {
        if (entity) {
            const {
                offeringName,
                currency,
                offeringType,
                subscriptionPrice,
                billingCycle,
                dimensionIds,
                discount,
                offeringVisibility,
                prepaidCredit,
                freeTrialLength,
                minimumCharge,
                metadata,
                dimensionOverrides,
            } = entity;
            this.offeringName = offeringName;
            this.currency = currency as unknown as SupportedOfferingCurrency;
            this.offeringType = offeringType;
            this.billingCycle = billingCycle;
            this.dimensionIds = dimensionIds;
            this.offeringType = offeringType;
            this.subscriptionPrice = subscriptionPrice;
            this.offeringVisibility = offeringVisibility;
            this.prepaidCredit = prepaidCredit;
            this.freeTrialLength = freeTrialLength;
            if (minimumCharge) {
                this.minimumCharge = minimumCharge;
            }
            if (dimensionOverrides) {
                this.dimensionOverrides = dimensionOverrides;
            }
            this.metadata = metadata;
        }
    }
}

export class CreateOfferingResponse extends BasicResponseDTO {
    /**
     * The identified of the offering.
     * Example `"fcb1fa34-8f11-4832-80f2-464cbc7a8546"`
     * @example "fcb1fa34-8f11-4832-80f2-464cbc7a8546"
     */
    public offeringId: string;
}

export class UpdateOfferingResponse extends BasicResponseDTO {
    /**
     * The identified of the offering.
     * Example `"fcb1fa34-8f11-4832-80f2-464cbc7a8546"`
     * @example "fcb1fa34-8f11-4832-80f2-464cbc7a8546"
     */
    public offeringId: string;
}
