import { Test, TestingModule } from '@nestjs/testing';
import { SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';
import { InfluxModule } from '../influx/influx.module.js';
import { forwardRef } from '@nestjs/common';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { UsersModule } from '../users/users.module.js';
import { createMock } from '@golevelup/ts-jest';

describe('SettingsController', () => {
    let controller: SettingsController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SettingsController],
            providers: [SettingsService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<SettingsController>(SettingsController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
