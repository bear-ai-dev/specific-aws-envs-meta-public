import { EntitlementWebookParameters } from '../../webhook/entities/webhook.entity.js';

export enum AlertState {
    'OK' = 'OK',
    'ALARM' = 'ALARM',
    'WARNING' = 'WARNING',
}
export enum AlertType {
    'ENTITLEMENT_THRESHOLD' = 'ENTITLEMENT_THRESHOLD',
}
export class CreateAlertDto {
    alertType: AlertType;
    alertState: AlertState;
    timestamp: string;
    businessID: string;
    metadata?: Record<string, any>;
    webhookParameters: EntitlementWebookParameters;
    alertId: string;
}
