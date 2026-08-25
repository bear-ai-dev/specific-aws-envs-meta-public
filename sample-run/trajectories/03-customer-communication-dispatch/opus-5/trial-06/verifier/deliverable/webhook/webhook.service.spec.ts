import { createMock } from '@golevelup/ts-jest';
import { Test, TestingModule } from '@nestjs/testing';
import { InfluxService } from '../influx/influx.service.js';
import { WebhookType } from './dto/create-webhook.dto.js';
import { Webhook } from './entities/webhook.entity.js';
import { WebhookProcessor } from './entities/webhookProcessor.js';
import { WebhookProcessorEventType, WebhookService } from './webhook.service.js';

//Jest Mock fecth call
jest.mock('cross-fetch', () => {
    return jest.fn().mockImplementation(() => {
        return {
            json: jest.fn().mockResolvedValue({}),
        };
    });
});
describe('WebhookService', () => {
    let service: WebhookService;
    let influx: InfluxService;
    let mockWebhookFetchCall;
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [WebhookService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<WebhookService>(WebhookService);
        influx = module.get<InfluxService>(InfluxService);
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        mockWebhookFetchCall = jest.spyOn(Webhook, 'makeRequest').mockImplementation(() => Promise.resolve({}));
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('Should make a request to a webhook if one is found', async () => {
        const webHookProcessor = new WebhookProcessor();
        webHookProcessor.webhookService = service;
        influx.getAllLatestHooksByType = jest.fn().mockResolvedValueOnce([
            {
                _value: 'https://www.bing.com',
                _time: '2021-01-01T00:00:00Z',
                _field: 'hookUrl',
                webhookId: 'some-id',
                webhookType: WebhookType.INVOICE_CREATED,
            },
        ]);
        await webHookProcessor.process({
            businessID: 'some-business-id',
            type: WebhookType.INVOICE_CREATED,
            data: [{}],
            topic: WebhookProcessorEventType.Standard,
        });

        expect(webHookProcessor.webhookService).toBeDefined();
        expect(influx.getAllLatestHooksByType).toBeCalledTimes(1);
        expect(mockWebhookFetchCall).toBeCalledTimes(1);
    });
    it('Should make a request to each webhook if more than one is found', async () => {
        const webHookProcessor = new WebhookProcessor();
        webHookProcessor.webhookService = service;
        influx.getAllLatestHooksByType = jest.fn().mockResolvedValueOnce([
            {
                _value: 'https://www.bing.com',
                _time: '2021-01-01T00:00:00Z',
                _field: 'hookUrl',
                webhookId: 'some-id',
                webhookType: WebhookType.INVOICE_CREATED,
            },
            {
                _value: 'https://www.bing.com',
                _time: '2021-01-01T00:00:00Z',
                _field: 'hookUrl',
                webhookId: 'some-id',
                webhookType: WebhookType.INVOICE_CREATED,
            },
        ]);
        await webHookProcessor.process({
            businessID: 'some-business-id',
            type: WebhookType.INVOICE_CREATED,
            data: [{}],
            topic: WebhookProcessorEventType.Standard,
        });

        expect(webHookProcessor.webhookService).toBeDefined();
        expect(influx.getAllLatestHooksByType).toBeCalledTimes(1);
        expect(mockWebhookFetchCall).toBeCalledTimes(2);
    });
    it('Should make a request to each webhook if more than one is found and once for each element of data', async () => {
        const webHookProcessor = new WebhookProcessor();
        webHookProcessor.webhookService = service;
        influx.getAllLatestHooksByType = jest.fn().mockResolvedValueOnce([
            {
                _value: 'https://www.bing.com',
                _time: '2021-01-01T00:00:00Z',
                _field: 'hookUrl',
                webhookId: 'some-id',
                webhookType: WebhookType.INVOICE_CREATED,
            },
            {
                _value: 'https://www.bing.com',
                _time: '2021-01-01T00:00:00Z',
                _field: 'hookUrl',
                webhookId: 'some-id',
                webhookType: WebhookType.INVOICE_CREATED,
            },
        ]);
        await webHookProcessor.process({
            businessID: 'some-business-id',
            type: WebhookType.INVOICE_CREATED,
            data: [{}, {}],
            topic: WebhookProcessorEventType.Standard,
        });

        expect(webHookProcessor.webhookService).toBeDefined();
        expect(influx.getAllLatestHooksByType).toBeCalledTimes(1);
        expect(mockWebhookFetchCall).toBeCalledTimes(4);
    });
    it('Should only request for webhooks of the type which is passed in', async () => {
        const webHookProcessor = new WebhookProcessor();
        webHookProcessor.webhookService = service;
        influx.getAllLatestHooksByType = jest.fn().mockResolvedValueOnce([
            {
                _value: 'https://www.bing.com',
                _time: '2021-01-01T00:00:00Z',
                _field: 'hookUrl',
                webhookId: 'some-id',
                webhookType: WebhookType.INVOICE_CREATED,
            },
            {
                _value: 'https://www.bing.com',
                _time: '2021-01-01T00:00:00Z',
                _field: 'hookUrl',
                webhookId: 'some-id',
                webhookType: WebhookType.INVOICE_CREATED,
            },
        ]);
        await webHookProcessor.process({
            businessID: 'some-business-id',
            type: WebhookType.INVOICE_CREATED,
            data: [{}, {}],
            topic: WebhookProcessorEventType.Standard,
        });

        expect(webHookProcessor.webhookService).toBeDefined();
        expect(influx.getAllLatestHooksByType).toBeCalledTimes(1);
        expect(influx.getAllLatestHooksByType).toBeCalledWith({
            businessID: 'some-business-id',
            webhookType: WebhookType.INVOICE_CREATED,
        });
    });
});
