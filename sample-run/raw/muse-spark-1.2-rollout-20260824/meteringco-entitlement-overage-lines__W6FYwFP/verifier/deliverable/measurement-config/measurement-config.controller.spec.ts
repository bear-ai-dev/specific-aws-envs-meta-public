import { Test, TestingModule } from '@nestjs/testing';
import { forwardRef } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module.js';
import { MeasurementConfigController } from './measurement-config.controller.js';
import { MeasurementConfigService } from './measurement-config.service.js';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module.js';
import { createMock } from '@golevelup/ts-jest';

describe('MeasurementConfigController', () => {
    let controller: MeasurementConfigController;
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MeasurementConfigController],
            providers: [MeasurementConfigService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<MeasurementConfigController>(MeasurementConfigController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
