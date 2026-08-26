import { Module } from '@nestjs/common';
import { ServicesService } from './services.service.js';

import { InfluxModule } from '../influx/influx.module.js';
import { UsageModule } from '../usage/usage.module.js';
import { forwardRef } from '@nestjs/common';
import { PublicAPIOfferingModule } from '../offering/offering.module.js';
import { PublicAPICustomerModule } from '../customer/customer.module.js';
import { ServiceIdExistsRule } from './dto/serviceIdExists.js';
import { PublicAPIDimensionsModule } from '../dimensions/dimensions.module.js';

@Module({
    providers: [ServicesService, ServiceIdExistsRule],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => UsageModule),
        forwardRef(() => PublicAPIOfferingModule),
        forwardRef(() => PublicAPICustomerModule),
        forwardRef(() => PublicAPIDimensionsModule),
    ],
    exports: [ServicesService],
})
export class PublicAPIServicesModule {}

@Module({})
export class PrivateAPIServicesModule extends PublicAPIServicesModule {}
