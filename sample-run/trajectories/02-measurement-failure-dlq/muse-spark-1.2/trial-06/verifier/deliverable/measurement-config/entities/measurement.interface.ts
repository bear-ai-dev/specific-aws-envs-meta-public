import { Point } from '@influxdata/influxdb-client';
import { MeasurementInfluxDbModel } from '../../influx/entities/measurementInfluxDbModel.interface.js';
import { InfluxService } from '../../influx/influx.service.js';
import { UsageRow } from '../../influx/entities/usageRow.entity.js';
export enum ValidMeasurementTypes {
    int = 'int',
    float = 'float',
}

export abstract class MeasurementFormat {
    dimensionId?: string;
    customerId: string;
    timestamp?: string;
    recordValue: number;
    businessID: string;
    metadata?: Record<string, string | number | null>;
    _measurement: string;
    static getPointForm(measurement: MeasurementFormat, influxService?: InfluxService, providedPoint?: Point): Point {
        let point;
        if (influxService) {
            point = influxService.getPoint(measurement._measurement);
        } else {
            point = providedPoint;
        }
        point.timestamp(new Date(measurement.timestamp));
        point.tag('customerId', measurement.customerId);
        point.tag('dimensionId', measurement.dimensionId);
        point.tag('businessID', measurement.businessID);
        point.floatField('recordValue', measurement.recordValue);
        if (measurement?.metadata) {
            Object.keys(measurement.metadata).forEach((key) => {
                point.tag(`metadata_${key}`, JSON.stringify(measurement.metadata[key]));
            });
        }
        return point;
    }
    static toEntity(dbModel: UsageRow): MeasurementFormat {
        const measurementInput: MeasurementFormat = {
            timestamp: dbModel._time,
            dimensionId: dbModel.dimensionId,
            recordValue: dbModel._value,
            metadata: {},
            _measurement: dbModel._measurement,
            businessID: dbModel.businessID,
            customerId: dbModel.customerId,
        };
        Object.keys(dbModel).forEach((key) => {
            if (key.startsWith('metadata_') && dbModel[key]) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                measurementInput.metadata[key.replace('metadata_', '')] = JSON.parse(dbModel[key]);
            }
        });
        return measurementInput;
    }
}
