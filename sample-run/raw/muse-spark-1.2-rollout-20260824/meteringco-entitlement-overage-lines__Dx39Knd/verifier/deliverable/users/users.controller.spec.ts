import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { InfluxModule } from '../influx/influx.module.js';
import { UsersController } from './users.controller.js';
import { EnvironmentService, OrganizationService, UsersService } from './users.service.js';

describe('UsersController', () => {
    let controller: UsersController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [UsersService, OrganizationService, EnvironmentService],
            imports: [InfluxModule],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<UsersController>(UsersController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
