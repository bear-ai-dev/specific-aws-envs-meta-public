import { ApiProperty } from '@nestjs/swagger';
import { ReadOfferingResponseData } from '../../offering/dto/readOffering.dto';
import { Offering } from '../../offering/entities/offeringPackage.entity';
import { CustomerContractDiscount } from './customerContractDiscount';
import { Type } from 'class-transformer';
import { IsOptional, IsRFC3339, IsString, ValidateNested } from 'class-validator';
import { ValidateFutureDate } from '../../customer/dto/validateFutureDate';
import { DimensionOverridesDto } from './dimensionOverrides.dto';

export class CustomOverrides {
    /**
     * A discount to be applied to the billing invoices associated with the customer/offering. Optional. Applies to the total invoice.
     * If `null` is passed in to the discount object, the discount will be removed from the customer. This does not generate an enrollment / unenrollment event
     *
     */
    @ApiProperty({ type: CustomerContractDiscount, required: false })
    @ValidateNested()
    @IsOptional()
    @Type(() => CustomerContractDiscount)
    public discount?: CustomerContractDiscount;
    /**
     * The end date of the free trial. Must be in the future and must be an RFC3339 date string.
     * <br><br>
     * Example: `"2021-01-01T00:00:00Z"`
     * @example "2021-01-01T00:00:00Z"
     *
     */
    @IsOptional()
    @IsString()
    @IsRFC3339()
    @ValidateFutureDate('freeTrialEndDate')
    public freeTrialEndDate?: string;

    /**
     * Applies custom overrides to dimensions associated with the offering. These effect the price of each dimension on the offering. Each dimension override must
     * have a unique dimensionId. Dimensions not included in the overrides will be defaulted based on their defined price. Dimensions overrides cannot change the "structure" of the price.
     * Meaning a tiered dimension cannot be changed to just have a consumption price and vice versa.
     *
     */
    @ApiProperty({ type: DimensionOverridesDto, required: false, isArray: true })
    @ValidateNested()
    @IsOptional()
    @Type(() => DimensionOverridesDto)
    public dimensionOverrides?: DimensionOverridesDto[];
    constructor(fields: CustomOverrides) {
        if (fields) {
            const { discount, freeTrialEndDate, dimensionOverrides } = fields;
            if (discount) {
                this.discount = discount;
            }
            if (freeTrialEndDate) {
                this.freeTrialEndDate = freeTrialEndDate;
            }
            if (dimensionOverrides && dimensionOverrides?.length > 0) {
                this.dimensionOverrides = dimensionOverrides;
            }
        }
    }
}
export class PrepareContractResponseDto {
    public customerId: string;
    public businessID: string;
    public offeringId: string;
    public overridesForOffering?: CustomOverrides;
    public offering?: Offering;
    public prepaidCredit?: string;
    public offeringEnrollmentDate: string;
    public readOfferingResponseData: ReadOfferingResponseData;

    constructor(fields: PrepareContractResponseDto) {
        if (fields) {
            const {
                customerId,
                businessID,
                offeringId,
                overridesForOffering,
                offering,
                prepaidCredit,
                offeringEnrollmentDate,
                readOfferingResponseData,
            } = fields;
            this.customerId = customerId;
            this.businessID = businessID;
            if (overridesForOffering) {
                this.overridesForOffering = overridesForOffering;
            }
            if (prepaidCredit) {
                this.prepaidCredit = prepaidCredit;
            }
            if (offeringId) {
                this.offeringId = offeringId;
            }

            if (offering) {
                this.offering = offering;
            }
            this.offeringEnrollmentDate = offeringEnrollmentDate;
            this.readOfferingResponseData = readOfferingResponseData;
        }
    }
}
