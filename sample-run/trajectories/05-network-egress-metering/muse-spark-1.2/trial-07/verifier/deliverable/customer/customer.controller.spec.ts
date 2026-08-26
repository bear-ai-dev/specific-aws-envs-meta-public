import { Test, TestingModule } from '@nestjs/testing';
import { PublicAPICustomerController } from './customer.controller.js';
import { CustomerService } from './customer.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('CustomerController', () => {
    let controller: PublicAPICustomerController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PublicAPICustomerController],
            providers: [CustomerService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<PublicAPICustomerController>(PublicAPICustomerController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
