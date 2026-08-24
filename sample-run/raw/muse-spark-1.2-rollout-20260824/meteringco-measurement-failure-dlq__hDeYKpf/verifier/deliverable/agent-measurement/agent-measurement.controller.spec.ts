import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentMeasurementController } from './agent-measurement.controller.js';
import { AgentMeasurementService } from './agent-measurement.service.js';

describe('AgentMeasurementController', () => {
    let controller: AgentMeasurementController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AgentMeasurementController],
            providers: [AgentMeasurementService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<AgentMeasurementController>(AgentMeasurementController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
