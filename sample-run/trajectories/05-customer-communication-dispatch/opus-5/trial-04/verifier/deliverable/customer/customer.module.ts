import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { PrivateAPICustomerController, PublicAPICustomerController } from './customer.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { PrivateAPIServicesModule } from '../services/services.module.js';
import { PrivateAPIOfferingModule } from '../offering/offering.module.js';
import { CustomerIdExistsRule } from './dto/customerIdExists.js';
import { UsageModule } from '../usage/usage.module.js';
import { PrivateAPIInvoicesModule } from '../invoice/invoices.module.js';
import { AuthzModule } from '../authz/authz.module.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';
import { CreditModule } from '../credit/credit.module.js';
import { PaymentModule } from '../payment/payment.module.js';
import { UsersModule } from '../users/users.module.js';
import { ContractModule } from '../contract/contract.module.js';
import { TokenConsumerModule } from '../token-consumer/token-consumer.module.js';
import { CustomerGroupModule } from '../customergroup/customergroup.module.js';

@Module({
    controllers: [PublicAPICustomerController],
    providers: [CustomerService, CustomerIdExistsRule],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => SchedulerModule),
        forwardRef(() => PrivateAPIServicesModule),
        forwardRef(() => PrivateAPIOfferingModule),
        forwardRef(() => UsageModule),
        forwardRef(() => PrivateAPIInvoicesModule),
        forwardRef(() => AuthzModule),
        forwardRef(() => PrivateAPISettingsModule),
        forwardRef(() => CreditModule),
        forwardRef(() => PaymentModule),
        forwardRef(() => UsersModule),
        forwardRef(() => ContractModule),
        forwardRef(() => TokenConsumerModule),
        forwardRef(() => CustomerGroupModule),
    ],
    exports: [CustomerService],
})
export class PublicAPICustomerModule implements OnModuleInit {
    onModuleInit() {
        CustomerService.subscribeForCustomerCommunications();
    }
}

@Module({
    controllers: [PrivateAPICustomerController],
})
export class PrivateAPICustomerModule extends PublicAPICustomerModule {}
