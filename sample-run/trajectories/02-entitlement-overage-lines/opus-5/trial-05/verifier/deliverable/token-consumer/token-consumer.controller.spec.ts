import { Test, TestingModule } from '@nestjs/testing';
import { TokenConsumerController } from './token-consumer.controller';
import { TokenConsumerService } from './token-consumer.service';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor';
import { PrivateAPICustomerModule } from '../customer/customer.module';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module';
import { PrivateAPIOfferingModule } from '../offering/offering.module';
import { forwardRef } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AuthzModule } from '../authz/authz.module';
import { InfluxModule } from '../influx/influx.module';
import { UsersModule } from '../users/users.module';

describe('TokenConsumerController', () => {
    let controller: TokenConsumerController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [TokenConsumerController],
            providers: [TokenConsumerService, TokenConsumerAsyncProcessor],
            imports: [
                forwardRef(() => PrivateAPICustomerModule),
                forwardRef(() => PrivateAPIDimensionsModule),
                forwardRef(() => PrivateAPIOfferingModule),
                forwardRef(() => SchedulerModule),
                forwardRef(() => AuthzModule),
                forwardRef(() => InfluxModule),
                forwardRef(() => UsersModule),
            ],
        }).compile();

        controller = module.get<TokenConsumerController>(TokenConsumerController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
