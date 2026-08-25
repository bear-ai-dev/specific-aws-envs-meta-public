import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { MargincalcController } from './margincalc.controller.js';
import { MargincalcService } from './margincalc.service.js';

describe('MargincalcController', () => {
    let controller: MargincalcController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MargincalcController],
            providers: [MargincalcService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<MargincalcController>(MargincalcController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
