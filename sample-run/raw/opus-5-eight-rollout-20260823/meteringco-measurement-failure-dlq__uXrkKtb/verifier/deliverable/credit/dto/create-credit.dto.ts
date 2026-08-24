import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsObject, IsOptional, IsRFC3339, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateCreditDto {
    /**
     * The unique identifier for the SaaS business
     * @example HarperDB
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID: string;
    /**
     * Unique identifier assigned by MeteringCo
     * <br><br>
     * Example: `"e345f409-daca-4144-91d2-0a0f87c96581"`
     * @example "e345f409-daca-4144-91d2-0a0f87c96581"
     */
    @ApiHideProperty()
    @IsString()
    @IsUUID()
    @IsOptional()
    public customerId: string;
    /**
     * The amount to credit the customer. Can be positive or negative. Customers cannot have a negative balance set via the API.
     * <br><br>
     * Example: `"100.00"`
     * @example "100.00"
     * @example "100"
     **/
    @IsNotEmpty()
    @Transform(({ value }) => parseFloat(value))
    @Min(-1000000000)
    @Max(1000000000)
    @IsNumber()
    @ApiProperty({ type: 'string', maximum: 1000000000, minimum: -1000000000 })
    public transactionAmount: string;
    /**
     * The timestamp of the credit. Optional. Will be set to right now UTC if not provided.
     * <br><br>
     * Example: `"2021-01-01T00:00:00.000Z"`
     * @example "2021-01-01T00:00:00.000Z"
     **/
    @IsString()
    @IsOptional()
    @IsRFC3339()
    public timestamp?: string;
    /**
     * The metadata to attach to the credit. Optional
     * <br><br>
     * Example: `{"key": "value"}`
     * @example {"key": "value"}
     **/
    @IsOptional()
    @IsObject()
    public metadata?: Record<string, string>;
}
