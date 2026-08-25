import { Module } from '@nestjs/common';
import { InfluxModule } from '../../influx/influx.module.js';
import { EntitlementChecker } from './entitlementChecker.service.js';
import { BullModule } from '@nestjs/bull';
import { AlertsModule } from '../../alerts/alerts.module.js';
import { PrivateAPICustomerModule } from '../../customer/customer.module.js';

@Module({
    controllers: [],
    providers: [EntitlementChecker],
    imports: [
        AlertsModule,
        PrivateAPICustomerModule,
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class EntitlementCheckerModule {}
