import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export interface MeasurementInfluxDbModel extends BaseInfluxTable {
    measurementId?: string;
    customerId?: string;
    dimensionId?: string;
    recordValue: number;
    uniqueInfrastructureId?: string;
    businessID: string;
    _field: string;
    _value: number;
    [metadata: string]: string | number;
}
