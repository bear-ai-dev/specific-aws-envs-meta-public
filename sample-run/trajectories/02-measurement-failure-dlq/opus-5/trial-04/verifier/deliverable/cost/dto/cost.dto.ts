import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

import { IsNotEmpty, IsOptional, IsString, IsArray, IsEnum, IsUUID } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ServiceEntity } from '../../services/entities/service.entity.js';
import { ArchiveCostSource, ComputeCostSource, StorageCostSource } from '../../setting/dto/update-settings.dto.js';

/**
 * The Create offering object enables a MeteringCo Client to create an new offering in the MeteringCo System.
 * This can correspond to a pricing tier, a subscription, a flat rate, or pure-usage based
 *
 *
 */
export class CostDTO {
    @IsString()
    public businessID: ServiceEntity['businessID'];
}

export class FindCostResponse extends BasicResponseDTO {
    public data: FindEBSCostResponseData[] | FindComputeCostResponseData[];
}
export class FindEBSCostResponseData {
    @ApiProperty()
    @IsString()
    public size: string;

    @ApiProperty()
    @IsString()
    public iops: string;

    @ApiProperty()
    @IsString()
    public throughput: string;

    @ApiProperty()
    @IsString()
    public averageUnitCost: string;
}

export class FindComputeCostResponseData {
    @ApiProperty()
    @IsString()
    public cpu: string;

    @ApiProperty()
    @IsString()
    public ram: string;

    @ApiProperty()
    @IsString()
    public averageUnitCost: string;
}

export enum supportedEBSTypes {
    gp3 = 'gp3',
    io2 = 'io2',
    gp2 = 'gp2',
}

export class CostSchedulerDto {
    costType: ComputeCostSource | StorageCostSource | ArchiveCostSource;
}
