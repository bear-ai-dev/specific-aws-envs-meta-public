import { Test, TestingModule } from '@nestjs/testing';
import { CreditService } from './credit.service.js';
import { InfluxService } from '../influx/influx.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('CreditService', () => {
    const customerId = 'fake-customer-id';
    const businessID = 'fake-business-id';
    const invoiceId = 'fake-invoice-id';
    let service: CreditService;
    let influxService: InfluxService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [CreditService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<CreditService>(CreditService);
        influxService = module.get<InfluxService>(InfluxService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should return correct paid amount', async () => {
        const paidAmount = 1234.56;
        jest.spyOn(influxService, 'sumAmountPaidByInvoiceId').mockResolvedValueOnce([{ _value: paidAmount }]);

        const result = await service.sumPaidAmountByInvoiceId({ customerId, businessID, invoiceId });

        expect(result).toEqual(paidAmount);
        expect(influxService.sumAmountPaidByInvoiceId).toHaveBeenCalledWith({ customerId, businessID, invoiceId });
    });

    it('should 0 if influx service returns empty array', async () => {
        jest.spyOn(influxService, 'sumAmountPaidByInvoiceId').mockResolvedValueOnce([]);

        const result = await service.sumPaidAmountByInvoiceId({ customerId, businessID, invoiceId });

        expect(result).toEqual(0);
        expect(influxService.sumAmountPaidByInvoiceId).toHaveBeenCalledWith({ customerId, businessID, invoiceId });
    });
});
