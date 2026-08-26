import { InfluxService } from '../../influx/influx.service.js';
import { EntitlementWebookParameters } from '../../webhook/entities/webhook.entity.js';
import { AlertState, AlertType, CreateAlertDto } from '../dto/create-alert.dto.js';
import { AlertInfluxRow } from '../../influx/entities/alertInfluxRow.entity.js';
import { Point } from '@influxdata/influxdb-client';

export class AlertEntity {
    public static _measurement = 'alert';
    alertType: AlertType;
    alertState: AlertState;
    timestamp: string;
    businessID: string;
    metadata: Record<string, any>;
    webhookParameters: EntitlementWebookParameters;
    alertId: string;

    constructor(createAlertDto: CreateAlertDto) {
        if (createAlertDto) {
            this.alertType = createAlertDto.alertType;
            this.alertState = createAlertDto.alertState;
            this.timestamp = createAlertDto.timestamp;
            this.businessID = createAlertDto.businessID;
            this.metadata = createAlertDto.metadata;
            this.webhookParameters = createAlertDto.webhookParameters;
            this.alertId = createAlertDto.alertId;
        }
    }

    public static transformer(alert: AlertEntity, influxService: InfluxService): Point[] {
        const alertPoint = influxService.getPoint(AlertEntity._measurement);
        alertPoint.tag('alertType', alert.alertType);
        alertPoint.stringField('alertState', alert.alertState);
        alertPoint.tag('businessID', alert.businessID);
        alertPoint.timestamp(alert.timestamp ? new Date(alert.timestamp) : new Date());
        alertPoint.tag('alertId', alert.alertId);
        if (alert.metadata) {
            alertPoint.tag('metadata', JSON.stringify(alert.metadata));
        }
        if (alert.webhookParameters) {
            alertPoint.tag('webhookParameters', JSON.stringify(alert.webhookParameters));
        }
        return [alertPoint];
    }

    public static fromDbModel(dbModel: AlertInfluxRow) {
        const { _value, alertId, alertType, businessID, metadata, _time, webhookParameters } = dbModel;
        const alert = new AlertEntity({
            alertState: _value as AlertState,
            alertType,
            businessID,
            metadata: metadata ? JSON.parse(metadata) : undefined,
            timestamp: _time,
            webhookParameters: webhookParameters ? JSON.parse(webhookParameters) : undefined,
            alertId,
        });
        return alert;
    }
}
