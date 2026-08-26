import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { MargincalcService } from './margincalc.service.js';

describe('MargincalcService', () => {
    let service: MargincalcService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [MargincalcService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<MargincalcService>(MargincalcService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
