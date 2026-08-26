import { Test, TestingModule } from '@nestjs/testing';
import { CostService } from './cost.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('CostService', () => {
    let service: CostService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [CostService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<CostService>(CostService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
