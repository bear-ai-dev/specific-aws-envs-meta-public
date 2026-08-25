import { AlertState, AlertType } from '../../alerts/dto/create-alert.dto.js';
import { AlertEntity } from '../../alerts/entities/alert.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class AlertInfluxRow extends BaseInfluxTable {
    public businessID: string;

    public declare _field: string;

    public declare _value: string;

    public _measurement = AlertEntity._measurement;

    public alertType: AlertType;

    public metadata: string;

    public webhookParameters: string;

    public alertId: string;
}
