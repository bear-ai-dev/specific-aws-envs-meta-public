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
    let service: SettingsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [SettingsController],
            providers: [SettingsService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<SettingsController>(SettingsController);
        service = module.get<SettingsService>(SettingsService);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    it('should let the business profile screen save its own field set', async () => {
        const request = { user: { businessID: 'some-business-id', sub: 'some-subject' } };
        const updateProfile = jest
            .spyOn(service, 'updateProfile')
            .mockResolvedValue({ message: 'Business profile updated successfully', data: [] });

        await controller.updateProfile({ postalCode: 'CB2 1RX' }, request as never);

        expect(updateProfile).toBeCalledWith({
            businessID: 'some-business-id',
            subject: 'some-subject',
            postalCode: 'CB2 1RX',
        });
    });
});
