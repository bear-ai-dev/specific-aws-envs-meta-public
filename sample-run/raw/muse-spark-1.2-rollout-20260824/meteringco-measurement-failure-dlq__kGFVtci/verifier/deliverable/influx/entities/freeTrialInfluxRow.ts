import { FreeTrialStatus } from '../../setting/dto/FreeTrialStatus.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class FreeTrialInfluxRow extends BaseInfluxTable {
    public declare _value: number;
    public freeTrialStatus: FreeTrialStatus;
    public businessID: string;
}
