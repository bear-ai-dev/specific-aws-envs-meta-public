import { IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { CreateContractDto } from '../../contract/dto/createContract.dto';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { CustomOverrides } from '../../contract/dto/prepareContractResponse.dto';

export class CreateCustomerEnrollmentDto {
    /**
     * Overrides for the offering. Applies Customer specific overrides to the offering. Such as a discount or free trial.
     */
    @ApiProperty({ type: CustomOverrides, required: false })
    @IsObject()
    @IsOptional()
    @Type(() => CustomOverrides)
    @ValidateNested()
    public overrides?: CustomOverrides;
    /**
     * Unique identifier for an offering assigned by MeteringCo. Including a new offeringId will "enroll" the customer in the specified offering. This may generate an invoice, in cases where relevant. Such as if the `"offeringType"` is a subscription offering.
     * To unenroll customers from an offering. Pass in `null`. This will remove the offering from the customer. This may generate an invoice, in cases where relevant. Such as if the `"offeringType"` is a usage-based offering.
     * Including the same offeringId multiple times in a row will not change the state of the customer, nor generate an invoice. If an offeringId is not included, the customer will remain enrolled in the same offering. Including a new offeringId while a customer is enrolled in an offering, is considered a change of plan or "upgrade". In specific cases of upgrades some credit might be issued for the remainder of their plan.
     * <br><br>
     * Example: `539b7f74-3832-474e-a955-6d69c5df12d0`
     *
     * @example "539b7f74-3832-474e-a955-6d69c5df12d0"
     */
    @IsString()
    @IsNotEmpty()
    public offeringId: string;
}
