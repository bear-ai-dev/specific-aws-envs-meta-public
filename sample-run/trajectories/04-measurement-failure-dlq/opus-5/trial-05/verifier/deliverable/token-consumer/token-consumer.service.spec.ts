import { Test, TestingModule } from '@nestjs/testing';
import { TokenConsumerService } from './token-consumer.service';
import { forwardRef } from '@nestjs/common';
import { PrivateAPICustomerModule } from '../customer/customer.module';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module';
import { PrivateAPIOfferingModule } from '../offering/offering.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AuthzModule } from '../authz/authz.module';
import { InfluxModule } from '../influx/influx.module';
import { UsersModule } from '../users/users.module';

describe('TokenConsumerService', () => {
    let service: TokenConsumerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [TokenConsumerService],
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

        service = module.get<TokenConsumerService>(TokenConsumerService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
