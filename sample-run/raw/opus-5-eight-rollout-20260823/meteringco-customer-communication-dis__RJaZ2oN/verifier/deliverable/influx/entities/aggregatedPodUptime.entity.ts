import { timeBasedUnits } from '../../dimensions/dto/create-dimension.dto.js';

import { upTimeAggregationEntity } from '../../dimensions/entities/uptimeAggregationEntity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class uptimeAggregationInfluxRow extends BaseInfluxTable {
    public _measurement = upTimeAggregationEntity._measurement;
    public declare _value: number;
    public declare _field: string;
    public startTime: string;
    public endTime: string;
    public units: timeBasedUnits;
    public dimensionId: string;
    public serviceId: string;
    public businessID: string;
    public applicationId: string;
}
