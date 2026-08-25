import { Test, TestingModule } from '@nestjs/testing';
import { PrivateInvoicesController } from './invoices.controller.js';
import { InvoicesService } from './invoices.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('InvoicesController', () => {
    let controller: PrivateInvoicesController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PrivateInvoicesController],
            providers: [InvoicesService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<PrivateInvoicesController>(PrivateInvoicesController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
