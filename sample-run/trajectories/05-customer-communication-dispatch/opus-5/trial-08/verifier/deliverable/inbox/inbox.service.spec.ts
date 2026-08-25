import { Test, TestingModule } from '@nestjs/testing';
import { InboxService } from './inbox.service.js';
import { InfluxModule } from '../influx/influx.module.js';

describe('InboxService', () => {
    let service: InboxService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [InboxService],
            imports: [InfluxModule],
        }).compile();

        service = module.get<InboxService>(InboxService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
