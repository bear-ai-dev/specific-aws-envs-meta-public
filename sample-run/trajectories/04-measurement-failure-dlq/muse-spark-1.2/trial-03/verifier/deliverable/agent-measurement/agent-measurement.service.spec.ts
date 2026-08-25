import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { AgentMeasurementService } from './agent-measurement.service.js';

describe('AgentMeasurementService', () => {
    let service: AgentMeasurementService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [AgentMeasurementService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<AgentMeasurementService>(AgentMeasurementService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
