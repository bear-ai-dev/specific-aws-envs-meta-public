import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto';
import { CustomerContractDiscount } from './customerContractDiscount';
import { IsOptional, IsRFC3339, IsString } from 'class-validator';
import { ValidateFutureDate } from '../../customer/dto/validateFutureDate';
import { CreateUsageDto, UsageForCustomerEnrollment } from '../../usage/dto/create-usage.dto';
import { DimensionOverridesDto } from './dimensionOverrides.dto';

export class CreateContractDto {
    @ApiHideProperty()
    @IsOptional()
    customerId: string;
    @ApiHideProperty()
    @IsOptional()
    businessID: string;
    @ApiProperty()
    @IsOptional()
    discount?: CustomerContractDiscount;

    @ApiProperty({ type: DimensionOverridesDto, required: false, isArray: true })
    @IsOptional()
    dimensionOverrides?: DimensionOverridesDto[];
    @ApiProperty()
    offeringId: string;
    @ApiProperty()
    @IsOptional()
    offeringEnrollmentDate?: string;
    @ApiHideProperty()
    @IsOptional()
    readSettingsResponseData?: ReadSettingsResponseData;

    /**
     * Free Trial End Date is the date time when a free trial is over for the customer. Must be in the future and a valid RFC 3999 date time.
     * <br><br>
     * Example: `"2199-02-01T11:00:00Z"`
     * @example "2199-02-01T11:00:00Z"
     */
    @IsOptional()
    @IsString()
    @IsRFC3339()
    @ValidateFutureDate('freeTrialEndDate')
    freeTrialEndDate?: string;

    usageOverrides?: UsageForCustomerEnrollment[];

    constructor(fields: CreateContractDto) {
        if (fields) {
            const {
                discount,
                customerId,
                offeringId,
                businessID,
                offeringEnrollmentDate,
                readSettingsResponseData,
                freeTrialEndDate,
                usageOverrides,
                dimensionOverrides,
            } = fields;
            this.customerId = customerId;
            this.businessID = businessID;
            this.readSettingsResponseData = readSettingsResponseData;
            this.offeringId = offeringId;
            if (discount) {
                this.discount = discount;
            }

            if (offeringEnrollmentDate) {
                this.offeringEnrollmentDate = offeringEnrollmentDate;
            }
            if (freeTrialEndDate) {
                this.freeTrialEndDate = freeTrialEndDate;
            }
            if (usageOverrides) {
                this.usageOverrides = usageOverrides;
            }
            if (dimensionOverrides) {
                this.dimensionOverrides = dimensionOverrides;
            }
        }
    }
}
