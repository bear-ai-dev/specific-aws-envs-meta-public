import { Test, TestingModule } from '@nestjs/testing';
import { AlertsService } from './alerts.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('AlertsService', () => {
    let service: AlertsService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [AlertsService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<AlertsService>(AlertsService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
