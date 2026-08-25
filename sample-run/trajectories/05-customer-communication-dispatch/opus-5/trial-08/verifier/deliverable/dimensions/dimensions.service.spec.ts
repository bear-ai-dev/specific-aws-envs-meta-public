import { Test, TestingModule } from '@nestjs/testing';
import { DimensionsService } from './dimensions.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('DimensionsService', () => {
    let service: DimensionsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [DimensionsService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<DimensionsService>(DimensionsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
