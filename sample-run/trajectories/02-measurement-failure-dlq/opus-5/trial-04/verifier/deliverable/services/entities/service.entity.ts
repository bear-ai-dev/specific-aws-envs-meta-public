import { Point } from '@influxdata/influxdb-client';
import { Logger } from '@nestjs/common';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { ServiceInfluxRow } from '../../influx/entities/serviceInfluxTable.entity.js';
import { InfluxService } from '../../influx/influx.service.js';
import { CreateServiceDto } from '../dto/createService.dto.js';

export class ServiceEntity {
    private static readonly logger = new Logger(ServiceEntity.name);
    @ApiHideProperty()
    public static _measurement = 'ServiceConfig';
    @ApiProperty()
    public customerId: string;
    @ApiHideProperty()
    public businessID: string;
    @ApiProperty()
    public offeringId: string;
    @ApiProperty()
    public serviceName: string;
    @ApiProperty()
    public serviceId: string;
    @ApiProperty()
    public applicationId: string;

    constructor({ customerId, businessID, serviceName, serviceId, offeringId, applicationId }: CreateServiceDto) {
        this.customerId = customerId;
        this.businessID = businessID;
        this.serviceName = serviceName;
        this.serviceId = serviceId;
        this.offeringId = offeringId;
        this.applicationId = applicationId;
    }
    static transformer(serviceEntity: ServiceEntity, influxService: InfluxService): Array<Point> {
        const serviceEntityPoint = influxService.getPoint(ServiceEntity._measurement);

        serviceEntityPoint.tag('customerId', serviceEntity.customerId);
        serviceEntityPoint.tag('businessID', serviceEntity.businessID);
        serviceEntityPoint.tag('offeringId', serviceEntity.offeringId);
        serviceEntityPoint.tag('serviceId', serviceEntity.serviceId);
        serviceEntityPoint.tag('applicationId', serviceEntity.applicationId);
        serviceEntityPoint.stringField('serviceName', serviceEntity.serviceName);
        // All Entity Transformers should return an array of points, keep logic consistent, even if there is only one element
        return [serviceEntityPoint];
    }

    static dbModelToEntity(dbModel: ServiceInfluxRow) {
        const { _value, businessID, customerId, serviceId, offeringId, applicationId } = dbModel;

        return new ServiceEntity({
            serviceName: _value,
            customerId,
            serviceId,
            businessID,
            offeringId,
            applicationId,
        });
    }
}
