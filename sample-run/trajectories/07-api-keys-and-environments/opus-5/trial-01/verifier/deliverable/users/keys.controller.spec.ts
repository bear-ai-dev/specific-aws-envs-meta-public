import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { InfluxModule } from '../influx/influx.module.js';
import { KeysController } from './keys.controller.js';
import { KeysService } from './keys.service.js';

describe('KeysController', () => {
    let controller: KeysController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [KeysController],
            providers: [KeysService],
            imports: [InfluxModule],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<KeysController>(KeysController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
