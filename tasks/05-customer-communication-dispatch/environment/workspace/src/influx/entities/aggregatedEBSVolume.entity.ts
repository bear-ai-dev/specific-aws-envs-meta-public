import { dataBasedUnits } from '../../dimensions/dto/create-dimension.dto.js';
import { ebsVolumeAggregationEntity } from '../../dimensions/entities/ebsVolumeAggregationEntity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class ebsVolumeAggregationEntityRow extends BaseInfluxTable {
    public static _measurement = ebsVolumeAggregationEntity._measurement;
    public startTime: string;
    public endTime: string;
    public declare _value: number;
    public declare _field: string;
    public units: dataBasedUnits;
    public dimensionId: string;
    public serviceId: string;
    public businessID: string;
    public applicationId: string;
    public volumeID: string;
}
