import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsObject, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { CustomOverrides } from '../../contract/dto/prepareContractResponse.dto';
import { UsageForCustomerEnrollment } from '../../usage/dto/create-usage.dto';
import { ValidateUniqueDimensions } from './hasNonOverlappingDimensions';
import { ValidateUnenrollmentCase } from './enrollmentValidation';

export class UpdateCustomerEnrollmentDto {
    /**
     * Overrides for the offering. Applies Customer specific overrides to the offering. Such as a discount or free trial or dimension specific overrides.
     */
    @ApiProperty({ type: CustomOverrides, required: false })
    @IsObject()
    @IsOptional()
    @Type(() => CustomOverrides)
    @ValidateNested()
    public overrides?: CustomOverrides;
    /**
     * Unique identifier for an offering assigned by MeteringCo. Including a new `"offeringId"` will "enroll" the customer in the specified offering. This may generate an invoice, in cases where relevant. Such as if the `"offeringType"` is a subscription offering. <br><br>
     * To unenroll customers from an offering. Pass in `null`. This will remove the offering from the customer. This may generate an invoice, in cases where relevant. Such as if the `"offeringType"` is a usage-based offering. <br><br>
     * Including the same `"offeringId" ` multiple times in a row will not change the state of the customer, nor generate an invoice. If an `"offeringId"` is not included, the customer will remain enrolled in the same offering. Including a new `"offeringId"` while a customer is enrolled in an offering, is considered a change of plan or "upgrade". In specific cases of upgrades some credit might be issued for the remainder of their plan. <br><br>
     * <br><br>
     * Example: `539b7f74-3832-474e-a955-6d69c5df12d0`
     *
     * @example "539b7f74-3832-474e-a955-6d69c5df12d0"
     */
    @IsString()
    @IsUUID()
    @IsOptional()
    public offeringId?: string;

    /**
     * An optional flag to remove the prior offering from the customer. If set to `true`, the customer will be removed from all of their prior offerings. This may generate an invoice, in cases where relevant. Such as if the `"offeringType"` is a usage-based offering. If set to `false`, the customer will remain enrolled in the same offering.
     * <br><br>
     * Example: `true`
     * @example true
     */
    @IsOptional()
    @IsBoolean()
    public removePriorOffering?: boolean;

    /**
     * Used to specifically unenroll a customer from a singular offering. This may generate an invoice, in cases where relevant. Such as if the
     * `"offeringType"` is a usage-based offering. Cannot be used in conjunction with `removePriorOffering` or enrolling a customer in a new
     * offering with the`offeringId` field. A 400 error will be returned if this is the case.
     * <br><br>
     * Example: `"177735fe-5d06-49a7-a8fb-f5da11773345"`
     * @example "177735fe-5d06-49a7-a8fb-f5da11773345"
     */
    @IsOptional()
    @IsString()
    @ValidateUnenrollmentCase('unenrollOffering')
    public unenrollOffering?: string;

    /**
     * Optionally, usage can be initally applied for a customer when they are enrolling in an offering.
     * This is used for dimensions which have a paymentSchedule of `upfront` and need to have some usage for the intial enrollment.
     * For example, a customer purchases 3 seats then on the enrollment a usage `recordValue` of 3 must be sent in for the time of purchase.
     * Multiple usage records can be sent in, regardless of dimension. If usage records are sent in for a dimension that is not on the current offering, they will be loaded into meteringco,
     * but ignored on the invoice. Additionally, records must be unique in the sense that they cannot have the same dimensionId. Duplicates will cause the request to be rejected.
     * <br><br>
     * Example: `[{ "dimensionId": "539b7f74-3832-474e-a955-6d69c5df12d0", "recordValue": 3, timestamp: "2021-01-01T00:00:00Z" }]`
     * @example [{ "dimensionId": "539b7f74-3832-474e-a955-6d69c5df12d0", "recordValue": 3, timestamp: "2021-01-01T00:00:00Z" }]
     */
    @IsArray()
    @ValidateUniqueDimensions('usage')
    @IsOptional()
    public usage?: UsageForCustomerEnrollment[];
}
