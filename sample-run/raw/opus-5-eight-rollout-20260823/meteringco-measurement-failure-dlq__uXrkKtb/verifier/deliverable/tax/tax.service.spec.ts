import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { TaxService } from './tax.service.js';

describe('TaxService', () => {
    let service: TaxService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [TaxService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<TaxService>(TaxService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
