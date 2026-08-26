import { Logger } from '@nestjs/common';
import { ApiHideProperty, ApiProperty, getSchemaPath, OmitType } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumberString, IsObject, IsOptional, IsRFC3339, IsString, IsUUID } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ReadCustomerResponseData } from '../../customer/entities/customer.entity.js';
import { aggregationInterval } from '../../dimensions/dto/create-dimension.dto.js';
import { ReadDimensionDto } from '../../dimensions/dto/read-dimension.dto.js';
import { ReadOfferingResponseData } from '../../offering/dto/readOffering.dto.js';
import { UsageDocument } from '../../usage/dto/read-usage.dto.js';
import { ServiceEntity } from '../entities/service.entity.js';
import { CreateServiceDto } from './createService.dto.js';

export class ReadServiceDTO {
    private static readonly logger = new Logger(ReadServiceDTO.name);
    // BusinessID used for lookup (Unique ID for business)
    @IsString()
    @IsNotEmpty()
    @ApiHideProperty()
    public businessID: string;

    // Client ID for the invoice used for lookup
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    public serviceId?: string;

    @IsString()
    @IsNotEmpty()
    @IsOptional()
    public offeringId?: string;

    static getServiceEntityDTO(dbServiceEntity: Array<any> = []): Array<CreateServiceDto> {
        const filteredEntities = dbServiceEntity.filter((entity) => {
            const { _measurement } = entity;
            if (_measurement === ServiceEntity._measurement) {
                return true;
            } else {
                ReadServiceDTO.logger.warn('Unknown Measurement Type found in response removing element in filter', {
                    entity,
                    _measurement,
                });
                return false;
            }
        }, []);
        const dto = filteredEntities.map((entity) => new CreateServiceDto(ServiceEntity.dbModelToEntity(entity)));

        if (dto) {
            return dto;
        }
    }
}

export class ReadServiceResponse extends BasicResponseDTO {
    public data: ReadServiceResponseData[];
}
export class ReadServiceResponseData extends OmitType(CreateServiceDto, ['offeringId', 'customerId'] as const) {
    public offering: ReadOfferingResponseData;
    public customer: ReadCustomerResponseData;

    /**
     * Unique identifier assigned by MeteringCo. This service ID can be used to link measurement data with services. For example, the measured usage data can have metadata with key `meteringcoServiceId` and value `e88595c2-abec-4a86-af34-daad942ae0c5`.
     *
     * @example 'e88595c2-abec-4a86-af34-daad942ae0c5'
     *
     *
     **/
    @IsUUID()
    public serviceId?: string;
}
