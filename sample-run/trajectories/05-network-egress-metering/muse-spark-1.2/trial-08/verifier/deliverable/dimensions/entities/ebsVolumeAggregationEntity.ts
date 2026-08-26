import { Point } from '@influxdata/influxdb-client';
import { InfluxService } from '../../influx/influx.service.js';
import { dataBasedUnits } from '../dto/create-dimension.dto.js';

export class ebsVolumeAggregationEntity {
    public static _measurement = 'ebsVolumeAggregation';
    public startTime: string;
    public endTime: string;
    public size: number;
    public units: dataBasedUnits;
    public dimensionId: string;
    public serviceId: string;
    public businessID: string;
    public applicationId: string;
    public volumeID: string;

    constructor({
        startTime,
        endTime,
        size,
        units,
        dimensionId,
        serviceId,
        businessID,
        applicationId,
        volumeID,
    }: ebsVolumeAggregationEntity) {
        this.startTime = startTime;
        this.endTime = endTime;
        this.size = size;
        this.units = units;
        this.dimensionId = dimensionId;
        this.serviceId = serviceId;
        this.businessID = businessID;
        this.applicationId = applicationId;
        this.volumeID = volumeID;
    }

    public static transformer(entity: ebsVolumeAggregationEntity, influx: InfluxService): Point {
        const ebsVolumeAggregationEntityPoint = influx.getPoint(ebsVolumeAggregationEntity._measurement);
        ebsVolumeAggregationEntityPoint.tag('dimensionId', entity.dimensionId);
        ebsVolumeAggregationEntityPoint.tag('serviceId', entity.serviceId);
        ebsVolumeAggregationEntityPoint.tag('businessID', entity.businessID);
        ebsVolumeAggregationEntityPoint.tag('applicationId', entity.applicationId);
        ebsVolumeAggregationEntityPoint.tag('units', entity.units);
        ebsVolumeAggregationEntityPoint.tag('volumeID', entity.volumeID);
        ebsVolumeAggregationEntityPoint.tag('startTime', entity.startTime);
        ebsVolumeAggregationEntityPoint.tag('endTime', entity.endTime);

        ebsVolumeAggregationEntityPoint.intField('size', entity.size);
        return ebsVolumeAggregationEntityPoint;
    }

    public static dbModelToEntity(dbModel: any): ebsVolumeAggregationEntity {
        return new ebsVolumeAggregationEntity({
            startTime: dbModel.startTime,
            endTime: dbModel.endTime,
            size: dbModel._value,
            units: dbModel.units,
            dimensionId: dbModel.dimensionId,
            serviceId: dbModel.serviceId,
            businessID: dbModel.businessID,
            applicationId: dbModel.applicationId,
            volumeID: dbModel.volumeID,
        });
    }
}
