import { IsArray, IsNotEmpty, IsNotEmptyObject } from 'class-validator';
import { DimensionTierDto } from './dimensionTier.dto';
import { TierUnitPriceValidator, TiersCannotOverlapValidator } from './tierValidator';

export class DimensionTiersGroupByMetadataDto {
    /**
     * The metadata groups to group the tiers by. A collection of key value pairs. metadata groups are used alongside the usage passed in to define more accurately how to break up price and usage for a dimension.
     * <br><br>
     * Example: `{ "instanceType": "t3.medium", "region": "us-east-1", "deployment": "production"}`
     * @example { "instanceType": "t3.medium", "region": "us-east-1", "deployment": "production"}
     */
    @IsNotEmptyObject()
    metadataGroups: Record<string, string>;

    @IsNotEmpty()
    @IsArray()
    @TierUnitPriceValidator('tiers')
    @TiersCannotOverlapValidator('tiers')
    tiers: DimensionTierDto[];
    constructor(fields: DimensionTiersGroupByMetadataDto) {
        if (fields) {
            this.metadataGroups = fields.metadataGroups;
            this.tiers = fields.tiers;
        }
    }
}
