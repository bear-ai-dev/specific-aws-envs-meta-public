import { Point } from '@influxdata/influxdb-client';
import { InfluxService } from '../../influx/influx.service.js';
import { timeBasedUnits } from '../dto/create-dimension.dto.js';

export class upTimeAggregationEntity {
    public static _measurement = 'upTimeAggregation';
    public startTime: string;
    public endTime: string;
    public upTime: number;
    public units: timeBasedUnits;
    public dimensionId: string;
    public serviceId: string;
    public businessID: string;
    public applicationId: string;

    constructor({
        startTime,
        endTime,
        upTime,
        units,
        dimensionId,
        serviceId,
        businessID,
        applicationId,
    }: upTimeAggregationEntity) {
        this.startTime = startTime;
        this.endTime = endTime;
        this.upTime = upTime;
        this.units = units;
        this.dimensionId = dimensionId;
        this.serviceId = serviceId;
        this.businessID = businessID;
        this.applicationId = applicationId;
    }

    public static transformer(entity: upTimeAggregationEntity, influx: InfluxService): Point {
        const upTimeAggregationEntityPoint = influx.getPoint(upTimeAggregationEntity._measurement);
        upTimeAggregationEntityPoint.tag('dimensionId', entity.dimensionId);
        upTimeAggregationEntityPoint.tag('serviceId', entity.serviceId);
        upTimeAggregationEntityPoint.tag('businessID', entity.businessID);
        upTimeAggregationEntityPoint.tag('applicationId', entity.applicationId);
        upTimeAggregationEntityPoint.tag('units', entity.units);
        upTimeAggregationEntityPoint.tag('startTime', entity.startTime);
        upTimeAggregationEntityPoint.tag('endTime', entity.endTime);

        upTimeAggregationEntityPoint.intField('upTime', entity.upTime);
        return upTimeAggregationEntityPoint;
    }

    public static dbModelToEntity(dbModel: any): upTimeAggregationEntity {
        return new upTimeAggregationEntity({
            startTime: dbModel.startTime,
            endTime: dbModel.endTime,
            upTime: dbModel._value,
            units: dbModel.units,
            dimensionId: dbModel.dimensionId,
            serviceId: dbModel.serviceId,
            businessID: dbModel.businessID,
            applicationId: dbModel.applicationId,
        });
    }
}
