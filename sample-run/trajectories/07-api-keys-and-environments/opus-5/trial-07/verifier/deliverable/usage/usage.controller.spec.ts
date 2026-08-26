import { Test, TestingModule } from '@nestjs/testing';
import { UsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('UsageController', () => {
    let controller: UsageController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsageController],
            providers: [UsageService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<UsageController>(UsageController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
