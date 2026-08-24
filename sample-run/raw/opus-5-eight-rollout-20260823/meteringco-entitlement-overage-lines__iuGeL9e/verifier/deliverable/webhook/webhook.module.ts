import { Module, OnModuleInit } from '@nestjs/common';
import { WebhookPublishingService, WebhookService } from './webhook.service.js';
import { WebhookController } from './webhook.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { ModuleRef } from '@nestjs/core';
import { UsersModule } from '../users/users.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { PrivateAPIInvoicesModule } from '../invoice/invoices.module.js';

@Module({
    controllers: [WebhookController],
    providers: [WebhookService],
    imports: [InfluxModule, UsersModule, SchedulerModule, PrivateAPIInvoicesModule],
})
export class WebhookModule implements OnModuleInit {
    constructor(private moduleRef: ModuleRef) {}
    onModuleInit() {
        const webhookService = this.moduleRef.get(WebhookService, { strict: false });
        WebhookPublishingService.subscribe(webhookService);
    }
}
