import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { WebhookController } from './webhook.controller.js';
import { WebhookService } from './webhook.service.js';

describe('WebhookController', () => {
    let controller: WebhookController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [WebhookController],
            providers: [WebhookService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<WebhookController>(WebhookController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});
