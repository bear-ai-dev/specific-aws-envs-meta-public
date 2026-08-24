import { InternalServerErrorException, Logger } from '@nestjs/common';
import { ApiHideProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUUID, IsArray, IsOptional, IsAlphanumeric, IsAscii, IS_ASCII } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { CreateCustomerDto } from '../../customer/dto/create-customer.dto.js';
import { CreateOfferingDTO } from '../../offering/dto/createOffering.dto.js';
import { OfferingPackageEntity } from '../../offering/entities/offeringPackage.entity.js';
import { ServiceEntity } from '../entities/service.entity.js';

export class CreateServiceDto {
    private static readonly logger = new Logger(CreateServiceDto.name);

    /**
     * The identifier of the customer that this service belongs to.
     *
     * @example 'k88595c2-abec-4a86-af34-daad942ae0c5'
     *
     **/
    @IsString()
    @IsNotEmpty()
    public customerId: CreateCustomerDto['customerId'];

    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     *
     * @example 'My Cool Corp'
     *
     **/
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * The identifier of offering that this service is billed by.
     *
     * @example 'abcd123-asf2-4444-aaaa-kashaskjh3421'
     *
     **/

    @IsString()
    @IsNotEmpty()
    public offeringId: OfferingPackageEntity['offeringId'];

    /**
     * A friendly, human-readable label for the service.
     *
     * @example 'My Cool Service'
     *
     **/
    @IsString()
    @IsNotEmpty()
    public serviceName: string;

    /**
     * Unique identifier assigned by MeteringCo.
     * This service ID can be used to link measurement data with services.
     *
     * @example 'e88595c2-abec-4a86-af34-daad942ae0c5'
     *
     *
     **/

    @IsUUID()
    @IsOptional()
    @ApiHideProperty()
    public serviceId?: string;

    /**
     * Unique identifier assigned by SaaS business.
     * This application ID can be used to link measurement data with services.
     * This application ID must be globally unique within the SaaS business organization.
     * Failed to ensure the global uniqueness may cause undesired billing errors.
     * Only ASCII characters are allowed.
     *
     * @example 'e88595c2-abec-4a86-af34-daad942ae0c5'
     *
     *
     **/

    @IsAscii()
    @IsOptional()
    public applicationId?: string;

    constructor(entity: ServiceEntity) {
        if (entity) {
            const { customerId, offeringId, serviceId, serviceName, applicationId } = entity;
            this.customerId = customerId;
            this.offeringId = offeringId;
            this.serviceName = serviceName;
            this.serviceId = serviceId;
            this.applicationId = applicationId;
        }
    }
}

export class CreateServiceResponse extends BasicResponseDTO {
    /**
     * The identifier of the service.
     *
     * @example 'e88595c2-abec-4a86-af34-daad942ae0c5'
     *
     *
     **/
    public serviceId: ServiceEntity['serviceId'];
}
