import { Module, forwardRef } from '@nestjs/common';
import { ContractService } from './contract.service';
import { InfluxModule } from '../influx/influx.module';
import { PrivateAPIOfferingModule } from '../offering/offering.module';
import { PrivateAPIInvoicesModule } from '../invoice/invoices.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { PrivateAPISettingsModule } from '../setting/settings.module';
import { CreditModule } from '../credit/credit.module';
import { PrivateAPICustomerModule } from '../customer/customer.module';
import { UsageModule } from '../usage/usage.module';

@Module({
    controllers: [],
    providers: [ContractService],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => SchedulerModule),
        forwardRef(() => PrivateAPIOfferingModule),
        forwardRef(() => PrivateAPIInvoicesModule),
        forwardRef(() => PrivateAPISettingsModule),
        forwardRef(() => PrivateAPICustomerModule),
        forwardRef(() => SchedulerModule),
        forwardRef(() => CreditModule),
        forwardRef(() => UsageModule),
    ],
    exports: [ContractService],
})
export class ContractModule {}
