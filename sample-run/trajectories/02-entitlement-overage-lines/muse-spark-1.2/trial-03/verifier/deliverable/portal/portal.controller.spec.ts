import { Test, TestingModule } from '@nestjs/testing';
import { PortalController } from './portal.controller.js';
import { PortalService } from './portal.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('PortalController', () => {
    let controller: PortalController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PortalController],
            providers: [PortalService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<PortalController>(PortalController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
