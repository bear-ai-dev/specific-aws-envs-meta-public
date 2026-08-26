import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsRFC3339, IsString } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ValidateFutureDate } from './validateFutureDate.js';
import { ValidatePastDate } from './validatePastDate.js';

export class UpdateFreeTrialDto {
    public offeringId?: string;
    /**
     * The end date of the free trial. Must be in the future and must be an RFC3339 date string.
     * <br><br>
     * Example: `"2021-01-01T00:00:00Z"`
     * @example "2021-01-01T00:00:00Z"
     *
     */
    @IsNotEmpty()
    @IsString()
    @IsRFC3339()
    @ValidateFutureDate('freeTrialEndDate')
    public freeTrialEndDate: string;

    /**
     * The start date of the free trial. Must be in the future and must be an RFC3339 date string. Optional to set, determines the free trial start date for a customer.
     * This is used during billing calculations to determine the proration amount for their free trial invoice.
     * <br><br>
     * Example: `"2021-01-01T00:00:00Z"`
     * @example "2017-01-01T00:00:00Z"
     *
     */
    @IsOptional()
    @IsString()
    @IsRFC3339()
    @ValidatePastDate('freeTrialStartDate')
    public freeTrialStartDate?: string;
}

export class UpdateFreeTrialResponseDto extends BasicResponseDTO {
    /**
     * Unique identifier assigned by MeteringCo
     * <br><br>
     * Example: `"e345f409-daca-4144-91d2-0a0f87c96581"`
     * @example "e345f409-daca-4144-91d2-0a0f87c96581"
     */
    @ApiProperty()
    public customerId: string;
}
