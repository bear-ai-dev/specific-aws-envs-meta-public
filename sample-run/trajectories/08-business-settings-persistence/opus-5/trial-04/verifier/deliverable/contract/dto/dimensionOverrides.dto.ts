import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DimensionTierDto } from '../../dimensions/dto/dimensionTier.dto';
import { DimensionTiersGroupByMetadataDto } from '../../dimensions/dto/dimensionTiersGroupByMetadataDto.dto';

export class DimensionOverridesDto {
    /**
     * The Id of the dimension that is being overridden.
     * <br><br>
     * Example: `"6a8fb855-206c-4226-8695-daf67352e7ee"`
     * @example "6a8fb855-206c-4226-8695-daf67352e7ee"
     */
    @IsString()
    @IsNotEmpty()
    dimensionId: string;

    /**
     * The price of the dimension. Must be a valid number.
     * <br><br>
     * Example: `"10.00"`
     * @example "10.00"
     */
    @IsOptional()
    consumptionPrice?: string;

    @IsOptional()
    tiers?: DimensionTierDto[];

    @IsOptional()
    tiersGroupByMetadata?: DimensionTiersGroupByMetadataDto[];
}
