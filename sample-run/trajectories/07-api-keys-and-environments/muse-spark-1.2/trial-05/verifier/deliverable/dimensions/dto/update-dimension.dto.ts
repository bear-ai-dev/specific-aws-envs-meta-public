import { ApiHideProperty, ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateDimensionDto } from './create-dimension.dto.js';
import { IsUUID, IsNotEmpty, IsString, IsOptional, ValidateNested } from 'class-validator';
import {
    TierEntitlementValidator,
    TierUnitPriceValidator,
    TierUsageIncrementCheckerValidator,
    TiersCannotOverlapValidator,
} from './tierValidator.js';
import { DimensionTierDto } from './dimensionTier.dto.js';
import { Type } from 'class-transformer';

export class UpdateDimensionDto extends PartialType(CreateDimensionDto) {
    /**
     * The Unique ID defining the dimension document
     * @example "abasd123-bbbb-aaaa-4444-777955dfffff"
     */
    @IsUUID()
    @IsOptional()
    @ApiHideProperty()
    public dimensionId: string;

    /**
     * The Unique ID associated with your specific business account
     * @example myCoolCorp
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * In order to remove tiers from a dimension, set the tiers array to `null`. The value passed to the tiers array will completely replace the existing tiers array.
     */
    @TierEntitlementValidator('tiers')
    @TierUnitPriceValidator('tiers')
    @TierUsageIncrementCheckerValidator('tiers')
    @TiersCannotOverlapValidator('tiers')
    @ValidateNested({ each: true })
    @Type(() => DimensionTierDto)
    public tiers?: DimensionTierDto[];
}
