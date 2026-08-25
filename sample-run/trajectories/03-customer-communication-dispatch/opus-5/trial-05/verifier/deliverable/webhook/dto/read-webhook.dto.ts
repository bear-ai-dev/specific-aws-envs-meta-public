import { Webhook } from '../entities/webhook.entity.js';
import { WebhookType } from './create-webhook.dto.js';

export class ReadWebhookDto {
    /**
     * The URL MeteringCo will callback to when the webhook type event occurs.
     * <br/><br/>
     * Example: `"https://example.com/webhook"`
     * @example "https://example.com/webhook"
     */
    hookUrl: string;
    /**
     * The unique identifier of the webhook.
     * <br/><br/>
     * Example: `"fcb1fa34-8f11-4832-80f2-464cbc7a8546"`
     * @example "fcb1fa34-8f11-4832-80f2-464cbc7a8546"
     */
    id: string;
    /**
     * The type of webhook event to listen for. This will determine when the webhook is triggered.
     * <br/><br/>
     * Example: `"INVOICE_CREATED"`
     * @example "INVOICE_CREATED"
     */
    webhookType: WebhookType;

    /**
     * The security key used to authenticate the webhook. This is used to ensure the webhook is coming from MeteringCo. The key will be sent in the `X-MeteringCo-Security` header.
     * <br/><br/>
     * Example: `"1234567890"`
     * @example "1234567890"
     */
    securityKey?: string;

    constructor({ webhookId, webhookType, hookUrl, securityKey }: Webhook) {
        this.hookUrl = hookUrl;
        this.id = webhookId;
        this.webhookType = webhookType;
        if (securityKey) {
            this.securityKey = securityKey;
        }
    }
}
