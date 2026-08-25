import { IsNotEmpty, IsOptional, IsString, IsISO8601 } from 'class-validator';
import { ReadPricingDTO } from '../../offering/dto/readOffering.dto.js';

export class InfluxQueryDimenisonDTO {
    @IsString()
    @IsNotEmpty()
    public _measurement: string;

    @IsString()
    @IsNotEmpty()
    public serviceId: string;

    @IsString()
    @IsNotEmpty()
    public businessID: string;

    @IsString()
    @IsNotEmpty()
    @IsISO8601()
    public startDate: string;

    @IsString()
    @IsNotEmpty()
    @IsISO8601()
    @IsOptional()
    public endDate: string;
}

export class InfluxQueryPricingConfigDTO extends ReadPricingDTO {}
