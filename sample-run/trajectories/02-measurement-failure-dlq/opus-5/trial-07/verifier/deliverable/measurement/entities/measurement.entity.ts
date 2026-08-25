import { Point } from '@influxdata/influxdb-client';
import { BadRequestException, Logger } from '@nestjs/common';
import { InfluxService } from '../../influx/influx.service.js';
import { CreateMeasurementDto } from '../dto/createMeasurement.dto.js';

export class MeasurementEntity {
    private static readonly logger = new Logger(MeasurementEntity.name);

    public static _measurement = 'CustomMeasurement';

    public measurementValue: string | number;

    public infrastructureType: string;

    public measurementType: 'string' | 'number';

    public serviceId: string;

    public measurementMetaData: any;

    public businessID: string;

    constructor({
        measurementValue,
        infrastructureType,
        measurementMetaData,
        measurementType,
        meteringcoID,
        businessID,
    }: CreateMeasurementDto) {
        this.measurementValue = measurementValue;
        this.infrastructureType = infrastructureType;
        this.measurementMetaData = measurementMetaData;
        this.measurementType = measurementType;
        this.serviceId = meteringcoID;
        this.businessID = businessID;
    }
    static transformer(measurementEntity: MeasurementEntity, influxService: InfluxService): Array<Point> {
        const measurementEntityPoint = influxService.getPoint(MeasurementEntity._measurement);

        measurementEntityPoint.tag('serviceId', measurementEntity.serviceId);
        measurementEntityPoint.tag('businessID', measurementEntity.businessID);

        Object.keys(measurementEntity.measurementMetaData).forEach((key) => {
            measurementEntityPoint.tag(key, measurementEntity.measurementMetaData[key].toString());
        });
        if (measurementEntity.measurementType === 'string') {
            measurementEntityPoint.stringField(
                measurementEntity.infrastructureType,
                measurementEntity.measurementValue,
            );
        } else if (measurementEntity.measurementType === 'number') {
            measurementEntityPoint.intField(measurementEntity.infrastructureType, measurementEntity.measurementValue);
        } else {
            throw new BadRequestException(
                `Invalid Type for measurementType: ${measurementEntity.measurementType}, Must be string or number`,
            );
        }

        // All Entity Transformers should return an array of points, keep logic consistent, even if there is only one element
        return [measurementEntityPoint];
    }
}
