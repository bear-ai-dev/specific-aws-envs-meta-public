import { Test, TestingModule } from '@nestjs/testing';
import { UsageService } from './usage.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('UsageService', () => {
    let service: UsageService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [UsageService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<UsageService>(UsageService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
