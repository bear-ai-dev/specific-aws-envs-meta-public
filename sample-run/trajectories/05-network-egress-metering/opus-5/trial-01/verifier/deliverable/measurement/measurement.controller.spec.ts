import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { InfluxModule } from '../influx/influx.module.js';
import { MeasurementController } from './measurement.controller.js';
import { MeasurementService } from './measurement.service.js';

describe('MeasurementController', () => {
    let controller: MeasurementController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MeasurementController],
            providers: [MeasurementService],
            imports: [InfluxModule],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<MeasurementController>(MeasurementController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
