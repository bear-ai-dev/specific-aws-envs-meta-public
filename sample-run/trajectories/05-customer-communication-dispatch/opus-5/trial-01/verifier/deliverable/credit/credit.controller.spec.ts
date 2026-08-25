import { Test, TestingModule } from '@nestjs/testing';
import { forwardRef } from '@nestjs/common';
import { PrivateAPICustomerModule } from '../customer/customer.module.js';
import { CreditController } from './credit.controller.js';
import { CreditService } from './credit.service.js';
import { InfluxModule } from '../influx/influx.module.js';
import { createMock } from '@golevelup/ts-jest';

describe('CreditController', () => {
    let controller: CreditController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [CreditController],
            providers: [CreditService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<CreditController>(CreditController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
