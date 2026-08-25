import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsRFC3339, IsString, Validate } from 'class-validator';
import {
    IsNumericStringGreaterThanOrEqualToZeroValidator,
    IsNumericStringLessThanOrEqualToHundredValidator,
} from '../../utils/validator';

export class CustomerContractDiscount {
    /**
     * The name of the discount. This will appear as is on the Invoice.
     * <br><br>
     * Example: `"Super Cool Discount"`
     */
    @ApiProperty({
        example: 'Super Cool Discount',
        description:
            'The name of the discount. This will appear as is on the Invoice. <br><br> Example:`"Super Cool Discount"`',
    })
    @IsString()
    @IsNotEmpty()
    public name: string;
    /**
     * The percentage of the discount.
     * This will be used to calculate the discount amount. Must be between 0 and 100 (inclusive).
     * <br><br>
     * Example: `"10"`
     */
    @ApiProperty({
        example: '10',
        description:
            'The percentage of the discount. This will be used to calculate the discount amount. Must be between 0 and 100 (inclusive). <br><br> Example: `"10"`',
    })
    @IsString()
    @Validate(IsNumericStringGreaterThanOrEqualToZeroValidator)
    @Validate(IsNumericStringLessThanOrEqualToHundredValidator)
    public percentage: string;
    /**
     * The end date of the discount. If not provided, the discount will be applied indefinitely. The date format should be an RFC3339 string.
     * The discount will be applied to any generated invoice that has an invoice creation date before the discount end date.
     * <br><br>
     * Example: `"2030-01-01T00:00:00Z"`
     */
    @ApiProperty({
        example: '2030-01-01T00:00:00Z',
        required: false,
        description:
            'The end date of the discount. If not provided, the discount will be applied indefinitely. The date format should be an RFC3339 string. The discount will be applied to any generated invoice that has an invoice creation date before the discount end date. <br><br> Example: `"2030-01-01T00:00:00Z"`',
    })
    @IsOptional()
    @IsRFC3339()
    public endDate?: string;
    constructor(fields: { name: string; percentage: string; endDate?: string }) {
        if (fields) {
            const { name, percentage, endDate } = fields;
            this.name = name;
            this.percentage = percentage;
            if (endDate) {
                this.endDate = endDate;
            }
        }
    }
}
