import { Test, TestingModule } from '@nestjs/testing';
import { PublicAPIOfferingController } from './offering.controller.js';
import { OfferingService } from './offering.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('OfferingController', () => {
    let controller: PublicAPIOfferingController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PublicAPIOfferingController],
            providers: [OfferingService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<PublicAPIOfferingController>(PublicAPIOfferingController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
