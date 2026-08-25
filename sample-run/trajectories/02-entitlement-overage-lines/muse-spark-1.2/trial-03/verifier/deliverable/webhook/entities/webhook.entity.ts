import { Point } from '@influxdata/influxdb-client';
import { randomUUID } from 'crypto';
import { WebhookInfluxRow } from '../../influx/entities/webhook.entity.js';
import { InfluxService } from '../../influx/influx.service.js';
import { CreateWebhookDto, WebhookType } from '../dto/create-webhook.dto.js';
import { fetch } from 'cross-fetch';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import {
    SchedulerCreationResponse,
    SchedulerStatus,
    SupportedMeasurementFrequencies,
    schedulerType,
} from '../../scheduler/dto/scheduler.dto.js';
import { AuditService } from '../../audit/audit.service.js';
import { serializeError } from 'serialize-error';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { Logger } from '@nestjs/common';

export class Webhook {
    private static readonly logger = new Logger(Webhook.name);
    static _measurement = 'webhook';
    hookUrl: string;
    webhookId: string;
    businessID: string;
    softDelete: string;
    webhookType: WebhookType;
    schedulerId: string;
    webhookParameters?: Record<string, string>;
    securityKey?: string;

    constructor(createWebhookDto: CreateWebhookDto, webhookId?: string, softDelete?: string) {
        if (createWebhookDto) {
            this.hookUrl = createWebhookDto.hookUrl;
            this.webhookId = webhookId || randomUUID();
            this.webhookType = createWebhookDto.webhookType;
            this.businessID = createWebhookDto.businessID;
            this.softDelete = softDelete;
            const { hookUrl, webhookType, businessID, environment, securityKey, ...rest } = createWebhookDto;
            if (rest) {
                this.webhookParameters = rest as Record<string, string>;
            }
            if (securityKey) {
                this.securityKey = securityKey;
            }
        }
    }

    static transformer(webhook: Webhook, influxService: InfluxService): Point[] {
        const webhookPoint = influxService.getPoint(Webhook._measurement);
        webhookPoint.tag('webhookId', webhook.webhookId);
        webhookPoint.stringField('hookUrl', webhook.hookUrl);
        webhookPoint.tag('webhookType', webhook.webhookType);
        webhookPoint.tag('businessID', webhook.businessID);
        if (webhook.softDelete) {
            webhookPoint.tag('softDelete', webhook.softDelete);
        }
        if (webhook?.schedulerId) {
            webhookPoint.tag('schedulerId', webhook.schedulerId);
        }
        if (webhook?.webhookParameters) {
            webhookPoint.tag('webHookParameters', JSON.stringify(webhook.webhookParameters));
        }
        if (webhook?.securityKey) {
            webhookPoint.tag('securityKey', webhook.securityKey);
        }
        return [webhookPoint];
    }

    static fromDbModel(dbModel: WebhookInfluxRow) {
        const { _value, webhookId, businessID, webhookType, securityKey } = dbModel;
        const webhook = new Webhook({ hookUrl: _value, webhookType, businessID, securityKey }, webhookId);
        return webhook;
    }

    static async makeRequest(webhook: Webhook, data: any) {
        const { hookUrl, securityKey } = webhook;
        const body = JSON.stringify(data);
        const headers = {
            'Content-Type': 'application/json',
        };
        if (securityKey) {
            headers['X-MeteringCo-Security'] = securityKey;
        }
        const response = await fetch(hookUrl, { method: 'POST', body, headers });
        return response;
    }
    static async createSchedulerForWebHook(
        schedulerService: SchedulerService,
        webhook: Webhook,
        subject: string,
    ): Promise<SchedulerCreationResponse> {
        if (webhook.webhookType === WebhookType.ENTITLEMENT) {
            const res = await schedulerService.create({
                schedulerID: webhook.webhookId,
                schedulerType: schedulerType.dimensionDataGathering,
                schedulerStatus: SchedulerStatus.live,
                scheduleParameters: {
                    offeringId: webhook?.webhookParameters?.offeringId,
                    businessID: webhook?.businessID,
                    dimensionType: 'entitlementChecker',
                },
                rate: SupportedMeasurementFrequencies.everyHour,
                subject,
                businessID: webhook.businessID,
            });
            const returnedRes = res.data[0] as SchedulerCreationResponse;
            return returnedRes;
        }
    }

    static async removeSchedulerForWebHook(schedulerService: SchedulerService, webhook: Webhook) {
        if (webhook.webhookType === WebhookType.ENTITLEMENT) {
            try {
                await schedulerService.remove({ schedulerID: webhook.webhookId, businessID: webhook.businessID });
            } catch (e) {
                AuditService.publishEvent({
                    message: 'Failed to remove scheduler for webhook',
                    data: [serializeError(e)],
                    topic: AuditScope.ERROR,
                });
                Webhook.logger.error(`Failed to remove scheduler for webhook: ${webhook.webhookId}`);
                Webhook.logger.error(serializeError(e));
            }
        }
    }
}

export class EntitlementWebookParameters {
    timestamp: string;
    dimensionId: string;
    entitlementLimit: string;
    currentUsageTotal: string;
    eventType: string;
    customerId: string;
    customerName: string;
    email: string;
    webhookType: WebhookType.ENTITLEMENT;
}
