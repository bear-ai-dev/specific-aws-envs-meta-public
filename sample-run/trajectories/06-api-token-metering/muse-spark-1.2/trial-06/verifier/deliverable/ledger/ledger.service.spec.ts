import { Test, TestingModule } from '@nestjs/testing';
import { LedgerService } from './ledger.service';
import { InfluxModule } from '../influx/influx.module';
import { forwardRef } from '@nestjs/common';

describe('LedgerService', () => {
    let service: LedgerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [LedgerService],
            imports: [forwardRef(() => InfluxModule)],
        }).compile();

        service = module.get<LedgerService>(LedgerService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
