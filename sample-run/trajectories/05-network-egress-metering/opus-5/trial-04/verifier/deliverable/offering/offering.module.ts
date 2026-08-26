import { Module, forwardRef } from '@nestjs/common';
import { OfferingService } from './offering.service.js';
import { PrivateAPIOfferingController, PublicAPIOfferingController } from './offering.controller.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PublicAPIDimensionsModule } from '../dimensions/dimensions.module.js';
import { OfferingIdExistsRule } from './dto/offeringIdExists.js';
import { PrivateAPICustomerModule } from '../customer/customer.module.js';
import { UsersModule } from '../users/users.module.js';
import { TokenConsumerModule } from '../token-consumer/token-consumer.module.js';

@Module({
    controllers: [PublicAPIOfferingController],
    providers: [OfferingService, OfferingIdExistsRule],
    imports: [
        forwardRef(() => InfluxModule),
        forwardRef(() => PublicAPIDimensionsModule),
        forwardRef(() => PrivateAPICustomerModule),
        forwardRef(() => UsersModule),
        forwardRef(() => TokenConsumerModule),
    ],
    exports: [OfferingService],
})
export class PublicAPIOfferingModule {}

@Module({
    controllers: [PrivateAPIOfferingController],
})
export class PrivateAPIOfferingModule extends PublicAPIOfferingModule {}
