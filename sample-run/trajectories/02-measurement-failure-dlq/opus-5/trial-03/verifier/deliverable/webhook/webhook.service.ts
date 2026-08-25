import { BadRequestException, forwardRef, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService } from '../users/users.service.js';
import { CreateWebhookDto, WebhookResponse } from './dto/create-webhook.dto.js';
import { ReadWebhookDto } from './dto/read-webhook.dto.js';
import { Webhook } from './entities/webhook.entity.js';
import { WebhookProcessor } from './entities/webhookProcessor.js';
import { WebhookProcessorRequest } from './entities/webhookProcessor.interface.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';

@Injectable()
export class WebhookService {
    private static logger = new Logger(WebhookService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentService: EnvironmentService,
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
    ) {}
    async findOne({ webhookId, businessID }: { webhookId: string; businessID: string }) {
        const { getLatestWebhook } = this.InfluxService;
        WebhookService.logger.debug(`finding webhook for  ${businessID} and ${webhookId}`);
        const webhook = await getLatestWebhook({ webhookId, businessID });
        if (!webhook.length) {
            throw new NotFoundException(`Webhook with id ${webhookId} not found`);
        }
        return new ReadWebhookDto(Webhook.fromDbModel(webhook[0]));
    }

    async findAll({ businessID }: { businessID: string }) {
        const { getAllLatestWebhooks } = this.InfluxService;
        const webhooks = await getAllLatestWebhooks({ businessID });
        return webhooks.map((webhook) => new ReadWebhookDto(Webhook.fromDbModel(webhook)));
    }

    async findAllByType({ businessID, webhookType }: { businessID: string; webhookType: string }) {
        const { getAllLatestHooksByType } = this.InfluxService;
        const webhooks = await getAllLatestHooksByType({ businessID, webhookType });
        return webhooks.map((webhook) => new ReadWebhookDto(Webhook.fromDbModel(webhook)));
    }
    async subscribe(createWebhookDto: CreateWebhookDto, sub?: string): Promise<WebhookResponse> {
        const entities = await this.environmentService.getEnvironmentsForUser(sub);
        const chosenEnvironment = createWebhookDto.environment || 'production';
        const result = entities.find((entity) => entity.environment === chosenEnvironment);
        if (!result?.businessID) {
            throw new BadRequestException(`Invalid Environment chosen: ${chosenEnvironment}`);
        }
        const { loadPoints } = this.InfluxService;
        WebhookService.logger.debug(`Subscribing to webhook ${JSON.stringify(createWebhookDto)}`);
        const webhook = new Webhook({ ...createWebhookDto, businessID: result?.businessID });
        const res = await Webhook.createSchedulerForWebHook(this.schedulerService, webhook, sub);
        if (res) {
            webhook.schedulerId = res.id;
        }
        await loadPoints(
            `${process.env.STAGE}-config`,
            `${process.env.INFLUX_ORG}`,
            Webhook.transformer(webhook, this.InfluxService),
        );

        return {
            message: 'Subscribed to webhook',
            id: webhook.webhookId,
            webhookId: webhook.webhookId,
            environment: chosenEnvironment,
        };
    }
    async unsubscribe({
        webhookId,
        subject,
        environment,
    }: {
        webhookId: string;
        subject: string;
        environment?: string;
    }): Promise<WebhookResponse> {
        // Validate that the webhook exists
        const entities = await this.environmentService.getEnvironmentsForUser(subject);
        const chosenEnvironment = environment || 'production';
        const { businessID } = entities.find((entity) => entity.environment === chosenEnvironment);
        const { webhookType, id, hookUrl } = await this.findOne({ webhookId, businessID });
        const { loadPoints } = this.InfluxService;
        const webhook = new Webhook({ webhookType, hookUrl, businessID }, id, 'deleted');
        await loadPoints(
            `${process.env.STAGE}-config`,
            `${process.env.INFLUX_ORG}`,
            Webhook.transformer(webhook, this.InfluxService),
        );
        await Webhook.removeSchedulerForWebHook(this.schedulerService, webhook);
        return {
            message: 'Unsubscribed from webhook',
            id: webhook.webhookId,
            webhookId: webhook.webhookId,
            environment: chosenEnvironment,
        };
    }
}

export enum WebhookProcessorEventType {
    'Standard' = 'Standard',
}
@Injectable()
export class WebhookPublishingService {
    public static hookProcessor = new WebhookProcessor();

    public static subscribe(webhookService: WebhookService) {
        WebhookPublishingService.hookProcessor.webhookService = webhookService;
        WebhookPublishingService.hookProcessor.on(
            WebhookProcessorEventType.Standard,
            WebhookPublishingService.hookProcessor.process,
        );
    }
    public static publishEvent(request: WebhookProcessorRequest) {
        WebhookPublishingService.hookProcessor.emit(request?.topic, request);
    }
}
