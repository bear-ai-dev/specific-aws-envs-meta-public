import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { InfluxModule } from '../influx/influx.module.js';
import { MeasurementService } from './measurement.service.js';

describe('MeasurementService', () => {
    let service: MeasurementService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [MeasurementService],
            imports: [InfluxModule],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<MeasurementService>(MeasurementService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
