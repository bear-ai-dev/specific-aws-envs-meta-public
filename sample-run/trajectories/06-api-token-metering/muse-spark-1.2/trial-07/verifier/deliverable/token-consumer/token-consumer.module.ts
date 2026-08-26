import { Inject, Module, forwardRef } from '@nestjs/common';
import { TokenConsumerService } from './token-consumer.service';
import { TokenConsumerController } from './token-consumer.controller';
import { BullModule } from '@nestjs/bull';
import { PrivateAPICustomerModule } from '../customer/customer.module';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module';
import { PrivateAPIOfferingModule } from '../offering/offering.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor';
import { AuthzModule } from '../authz/authz.module';
import { InfluxModule } from '../influx/influx.module';
import { UsersModule } from '../users/users.module';

@Module({
    controllers: [TokenConsumerController],
    providers: [TokenConsumerService, TokenConsumerAsyncProcessor],
    exports: [TokenConsumerService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
        forwardRef(() => PrivateAPICustomerModule),
        forwardRef(() => PrivateAPIDimensionsModule),
        forwardRef(() => PrivateAPIOfferingModule),
        forwardRef(() => SchedulerModule),
        forwardRef(() => AuthzModule),
        forwardRef(() => InfluxModule),
        forwardRef(() => UsersModule),
    ],
})
export class TokenConsumerModule {}
