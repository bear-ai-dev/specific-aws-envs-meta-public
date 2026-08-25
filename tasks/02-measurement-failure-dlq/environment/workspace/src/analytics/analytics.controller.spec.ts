import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { InfluxModule } from '../influx/influx.module.js';
import { PrivateAPISettingsModule } from '../setting/settings.module.js';
import { PrivateAPIServicesModule } from '../services/services.module.js';
import { createMock } from '@golevelup/ts-jest';

describe('AnalyticsController', () => {
    let controller: AnalyticsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AnalyticsController],
            providers: [AnalyticsService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<AnalyticsController>(AnalyticsController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
