import { BaseInfluxTable } from '../../influx/entities/baseInfluxTable.entity.js';
import { Inbox } from './inbox.entity.js';

export class InboxInfluxRow extends BaseInfluxTable {
    public _measurement = Inbox._measurement;
    public declare _value: string;
    public declare _field: string;
    public businessID: string;
    public inboxId: string;
    public title: string;
    public description: string;
    public level: string;
    public isArchived: string;
    public messageReceivedDate: string;
}
