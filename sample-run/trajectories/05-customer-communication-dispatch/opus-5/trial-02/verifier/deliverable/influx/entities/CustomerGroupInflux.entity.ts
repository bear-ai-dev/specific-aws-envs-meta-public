import { BillParent } from 'customergroup/entities/BillParent';
import { BaseInfluxTable } from './baseInfluxTable.entity';

export class CustomerGroupInfluxRow extends BaseInfluxTable {
    declare _value: string;
    public parentId: string;
    public businessID: string;
    public groupId: string;
    public groupName?: string;
    public groupDescription?: string;
    public metadata?: string;
}

export class ChildRowInfluxRow extends BaseInfluxTable {
    declare _value: string;
    public parentId: string;
    public businessID: string;
    public billParent: BillParent;
    public childId: string;
}
