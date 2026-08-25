import { Module, forwardRef } from '@nestjs/common';
import { InvoicesService } from './invoices.service.js';
import { PrivateInvoicesController, PublicAPIInvoicesController } from './invoices.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';
import { PrivateAPICustomerModule } from '../customer/customer.module.js';
import { TaxModule } from '../tax/tax.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { CreditModule } from '../credit/credit.module.js';
import { ContractModule } from '../contract/contract.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { TokenConsumerModule } from '../token-consumer/token-consumer.module.js';
import { AuthzModule } from '../authz/authz.module.js';

@Module({
    controllers: [PublicAPIInvoicesController],
    providers: [InvoicesService],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PrivateAPISettingsModule),
        forwardRef(() => PrivateAPICustomerModule),
        forwardRef(() => PaymentModule),
        forwardRef(() => UsageModule),
        forwardRef(() => PrivateAPIDimensionsModule),
        forwardRef(() => TaxModule),
        forwardRef(() => CreditModule),
        forwardRef(() => ContractModule),
        forwardRef(() => SchedulerModule),
        forwardRef(() => TokenConsumerModule),
        forwardRef(() => AuthzModule),
    ],
    exports: [InvoicesService],
})
export class PublicAPIInvoicesModule {}
@Module({
    controllers: [PrivateInvoicesController],
    providers: [InvoicesService],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PrivateAPISettingsModule),
        forwardRef(() => PrivateAPICustomerModule),
        forwardRef(() => PaymentModule),
        forwardRef(() => UsageModule),
        forwardRef(() => PrivateAPIDimensionsModule),
        forwardRef(() => TaxModule),
        forwardRef(() => CreditModule),
        forwardRef(() => ContractModule),
        forwardRef(() => SchedulerModule),
        forwardRef(() => TokenConsumerModule),
        forwardRef(() => AuthzModule),
    ],
    exports: [InvoicesService],
})
export class PrivateAPIInvoicesModule extends PublicAPIInvoicesModule {}
