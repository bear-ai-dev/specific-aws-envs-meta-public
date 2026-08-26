import { Module, forwardRef } from '@nestjs/common';
import { BillingService } from './billing.service.js';
import { PrivateAPIInvoicesModule } from '../invoice/invoices.module.js';
import { InfluxModule } from '../influx/influx.module.js';
import { BullModule } from '@nestjs/bull';
import { PrivateAPICustomerModule } from '../customer/customer.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';
import { ContractModule } from '../contract/contract.module.js';

@Module({
    providers: [BillingService],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PrivateAPICustomerModule),
        forwardRef(() => PrivateAPIInvoicesModule),
        forwardRef(() => SchedulerModule),
        forwardRef(() => ContractModule),
        forwardRef(() => PrivateAPISettingsModule),
        BullModule.registerQueue({
            name: 'scheduler_billing_queue',
        }),
    ],
})
export class BillingModule {}
