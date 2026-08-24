import { PartialType } from '@nestjs/swagger';
import { BaseInfluxTable } from './baseInfluxTable.entity';

export class UsageRow extends BaseInfluxTable {
    public dimensionId: string;
    public businessID: string;
    public customerId: string;
    public declare _value: number;
    public declare _field: string;
    [key: string]: string | number | Record<string, string> | undefined;
}

export class AggregatedUsageRow extends PartialType(UsageRow) {}
