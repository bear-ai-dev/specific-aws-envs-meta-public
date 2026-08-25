import { Logger } from '@nestjs/common';
import { serializeError } from 'serialize-error';
import EventEmitter from 'events';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { WebhookService } from '../webhook.service.js';
import { Webhook } from './webhook.entity.js';
import { WebhookProcessorInterface, WebhookProcessorRequest } from './webhookProcessor.interface.js';

export class WebhookProcessor extends EventEmitter implements WebhookProcessorInterface {
    private static logger = new Logger(WebhookProcessor.name);
    webhookService: WebhookService;
    constructor() {
        super();
    }

    async process(publishRequest: WebhookProcessorRequest) {
        WebhookProcessor.logger.log('WebhookProcessor start');
        const { data, type, businessID } = publishRequest;
        const webhooks = await this.webhookService.findAllByType({ businessID, webhookType: type });
        if (webhooks?.length) {
            WebhookProcessor.logger.log(
                `Found ${webhooks.length} webhooks for business ${businessID} and type ${type}`,
            );
            await Promise.all(
                data.map(async (dataElement) => {
                    return await Promise.all(
                        webhooks.map(async (webhook) => {
                            const newHook = new Webhook({ ...webhook, businessID }, webhook.id);
                            try {
                                await Webhook.makeRequest(newHook, dataElement);
                            } catch (e) {
                                WebhookProcessor.logger.error(serializeError(e));
                                AuditService.publishEvent({
                                    topic: AuditScope.ERROR,
                                    message: `Error processing webhook ${newHook.webhookId} for business ${businessID} and type ${type}`,
                                    data: serializeError(e),
                                });
                            }
                        }),
                    );
                }),
            );
        } else {
            WebhookProcessor.logger.log(`No webhooks found for business ${businessID} and type ${type}`);
        }
    }
}
