import { Logger } from '@nestjs/common';
import { ApiHideProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional, IsISO8601, IsEnum, IsArray } from 'class-validator';
import { MeteringCoFilters } from '../../measurement-config/entities/measurement-config.entity.js';

export class DiscoverServiceDto {
    private static readonly logger = new Logger(DiscoverServiceDto.name);
    /**
     * BusinessID used for lookup, Unique ID for business MeteringCo, This is automatically gathered through Auth. Not needed for the request
     * @example myCoolCorp
     * @example 123Bend980
     * */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * Determines if the values should be sorted or not
     * @example true
     * @example false
     * */

    @IsString()
    @IsOptional()
    public sort?: string;

    /**
     * Array of strings containing the "filterKey" and "filterValue" to filter on. Multiple filters will be considered logical ANDs
     * Must be URI encoded
     * @example [{"filterKey": "foobar", "filterValue": 100 }, {"filterKey":"label_meteringco_service_id", "filterValue": "1234-abc-1337"}]
     * */

    @IsOptional()
    @IsArray()
    public metadataFilters?: Array<MeteringCoFilters>;

    /**
     *
     * Start time ISO8601
     * If the time is not provided, it assumes the date is from Unix Start time. (January 1st, 1970 00:00:00 UTC) This can practically be assumed from starting from the beginning of time
     */

    @IsISO8601()
    @IsOptional()
    public startTime?: Date;

    /**
     *
     * End time ISO8601
     * If the time is not provided, it assumes the time the request was recieved.
     */

    @IsISO8601()
    @IsOptional()
    public endTime?: Date;

    /**
     *
     * Limit the number of infra units to get data for
     *  @example 100
     *  @default 100
     */

    @IsOptional()
    public limit?: number;

    /**
     *
     * Offset to use for the number of pods to get data for
     * @example 150
     * @default 0
     */

    @IsOptional()
    public offset?: number;
}
