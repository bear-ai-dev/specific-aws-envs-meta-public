import { Webhook } from '../../webhook/entities/webhook.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class WebhookInfluxRow extends BaseInfluxTable {
    public static _measurement = Webhook._measurement;

    /**
     * The URL which the webhook will send a request to.
     */
    public declare _value: Webhook['hookUrl'];

    public declare _field: string;

    /**
     * The type of webhook
     * @example "INVOICE_CREATED"
     * @example "INVOICE_PAID"
     **/
    public webhookType: Webhook['webhookType'];

    /**
     * The business ID which the webhook is associated with.
     * @example "myCoolCorp"
     **/
    public businessID: Webhook['businessID'];

    /**
     * The ID of the webhook.
     * @example "123e4567-e89b-12d3-a456-426614174000"
     **/
    public webhookId: Webhook['webhookId'];

    /**
     * The security key used to authenticate the webhook. This is used to ensure the webhook is coming from MeteringCo. The key will be sent in the `X-MeteringCo-Security` header.
     * @example "1234567890"
     */
    public securityKey?: Webhook['securityKey'];
}
