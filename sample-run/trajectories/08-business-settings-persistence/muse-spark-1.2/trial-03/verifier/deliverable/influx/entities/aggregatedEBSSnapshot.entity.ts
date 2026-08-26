import { dataBasedUnits } from '../../dimensions/dto/create-dimension.dto.js';
import { ebsSnapshotAggregationEntity } from '../../dimensions/entities/ebsSnapshotAggregationEntity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class ebsSnapshotAggregationEntityRow extends BaseInfluxTable {
    public _measurement = ebsSnapshotAggregationEntity._measurement;
    public startTime: string;
    public endTime: string;
    public declare _value: number;
    public declare _field: string;
    public units: dataBasedUnits;
    public dimensionId: string;
    public serviceId: string;
    public businessID: string;
    public applicationId: string;
    public snapshotId: string;
}
