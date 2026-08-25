import { Test, TestingModule } from '@nestjs/testing';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { createMock } from '@golevelup/ts-jest';

describe('PaymentController', () => {
    let controller: PaymentController;
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PaymentController],
            providers: [PaymentService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<PaymentController>(PaymentController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
