import { Module, forwardRef } from '@nestjs/common';
import { UsageService } from './usage.service.js';
import { PrivateAPIUsageController, UsageController } from './usage.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { MeasurementConfigModule } from '../measurement-config/measurement-config.module.js';
import { PublicAPIDimensionsModule } from '../dimensions/dimensions.module.js';
import { PublicAPIOfferingModule } from '../offering/offering.module.js';
import { PublicAPICustomerModule } from '../customer/customer.module.js';
import { PrivateAPIInvoicesModule } from '../invoice/invoices.module.js';
import { TokenConsumerModule } from '../token-consumer/token-consumer.module.js';

@Module({
    controllers: [UsageController],
    providers: [UsageService],
    exports: [UsageService],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => MeasurementConfigModule),
        forwardRef(() => PublicAPIDimensionsModule),
        forwardRef(() => PublicAPICustomerModule),
        forwardRef(() => PublicAPIOfferingModule),
        forwardRef(() => PrivateAPIInvoicesModule),
        forwardRef(() => TokenConsumerModule),
    ],
})
export class UsageModule {}

@Module({
    controllers: [PrivateAPIUsageController],
})
export class PrivateApiUsageModule extends UsageModule {}
