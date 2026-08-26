import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class MonthlyCostInfluxRow extends BaseInfluxTable {
    public declare _value: number;
    public declare _time: string;
}
