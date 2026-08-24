import { Test, TestingModule } from '@nestjs/testing';
import { CustomerGroupService } from './customergroup.service';
import { LedgerModule } from '../ledger/ledger.module';
import { forwardRef } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module';

describe('CustomergroupService', () => {
    let service: CustomerGroupService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [CustomerGroupService],
            imports: [forwardRef(() => InfluxModule), forwardRef(() => LedgerModule)],
        }).compile();

        service = module.get<CustomerGroupService>(CustomerGroupService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
