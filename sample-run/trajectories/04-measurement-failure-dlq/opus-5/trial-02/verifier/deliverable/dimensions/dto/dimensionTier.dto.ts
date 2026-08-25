import { IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';
import { NumberStringCanbeInf } from './tierValidator';

export class DimensionTierDto {
    /**
     * The name of the tier as it would appear on the invoice. If Tier name is not included, no `tierName` will be displayed on the invoice, and it will follow the default line item naming standard. See: https://docs.meteringco.example/invoicing-and-payment/issue-invoice/automatic-line-item-formatting
     * <br><br>
     * Example: `"Tier 1"`
     * @example "Tier 1"
     */
    @IsOptional()
    @IsString()
    tierName?: string;
    /**
     * The upper limit of the tier, inclusive. If the upperBound is set to "inf", it must have the highest `tierPosition`. Additionally, the `upperBound` must be a multiple of the `usageIncrement`
     * on the dimension. For example, if the `usageIncrement` is 100, the `upperBound` must be 100, 200, 300, etc. The `upperBound` cannot overlap with previous tiers, so tier 1's `upperBound` must be smaller than tier 2's.
     * <br><br>
     * Example: `"100"`
     *
     * @example "100"
     */
    @IsNotEmpty()
    @IsString()
    @NumberStringCanbeInf('upperBound')
    upperBound: string;
    /**
     * The unit price of the tier.
     * <br><br>
     * Example: `"10"`
     *
     * @example "10"
     */
    @IsOptional()
    @IsString()
    @IsNumberString()
    unitPrice?: string;

    /**
     * The position of the tier. The first tier must have a `tierPosition` of 1, the second tier must have a `tierPosition` of 2, etc. Order of the tiers is determined by the `tierPosition`.
     * <br><br>
     * Example: `"1"`
     * @example "1"
     */
    @IsNotEmpty()
    @IsString()
    @IsNumberString()
    tierPosition: string;

    constructor(fields: DimensionTierDto) {
        if (fields) {
            if (fields.unitPrice) {
                this.unitPrice = fields.unitPrice;
            }
            if (fields.tierName) {
                this.tierName = fields.tierName;
            }
            this.tierPosition = fields.tierPosition;
            this.upperBound = fields.upperBound;
        }
    }
}
