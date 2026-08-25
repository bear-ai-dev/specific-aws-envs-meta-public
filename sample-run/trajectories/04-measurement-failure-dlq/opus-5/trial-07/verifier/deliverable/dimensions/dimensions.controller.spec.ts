import { Test, TestingModule } from '@nestjs/testing';
import { PublicAPIDimensionsController } from './dimensions.controller.js';
import { DimensionsService } from './dimensions.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('DimensionsController', () => {
    let controller: PublicAPIDimensionsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PublicAPIDimensionsController],
            providers: [DimensionsService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<PublicAPIDimensionsController>(PublicAPIDimensionsController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
