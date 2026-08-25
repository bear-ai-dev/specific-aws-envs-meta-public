import { Test, TestingModule } from '@nestjs/testing';
import { LedgerController } from './ledger.controller';
import { LedgerService } from './ledger.service';
import { InfluxModule } from '../influx/influx.module';
import { forwardRef } from '@nestjs/common';

describe('LedgerController', () => {
    let controller: LedgerController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [LedgerController],
            providers: [LedgerService],
            imports: [forwardRef(() => InfluxModule)],
        }).compile();

        controller = module.get<LedgerController>(LedgerController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
