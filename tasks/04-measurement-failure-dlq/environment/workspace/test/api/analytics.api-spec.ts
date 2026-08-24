import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { InfluxService } from '../../src/influx/influx.service';
import { AuthGuard } from '@nestjs/passport';
import { MockInfluxService } from '../fixtures/module/mockInfluxService';
import { MockJwtStrategy } from '../fixtures/module/mockJwtStrategy';
import { getQueueOptionsToken, getQueueToken } from '@nestjs/bull';
import { createMock } from '@golevelup/ts-jest';
import { Queue, QueueOptions } from 'bull';
import { TokenConsumerService } from '../../src/token-consumer/token-consumer.service';
import { TokenRegisterInterceptor } from '../../src/interceptors/tokenRegisterInterceptor';
import { MockTokenRegister } from '../fixtures/module/mockTokenRegister';

jest.mock('stripe', () =>
    jest.fn().mockImplementation(() => ({
        customers: { create: jest.fn(() => ({ id: 'foobarTest' })) },
        billingPortal: { sessions: { create: jest.fn(() => ({ url: 'https://fakeMeteringCoTester.com' })) } },
        accounts: {
            retrieve: jest.fn((id) =>
                id === 'badAccount'
                    ? { id, details_submitted: false, invoice_settings: { default_payment_method: null } }
                    : { id: 'fakeStripeAccountId', details_submitted: true },
            ),
        },
    })),
);
jest.mock('../../src/utils/shared/utils', () => ({
    sleep: jest.fn(),
    ArrayGroupBy: jest.fn(),
    suffixIfNotEmpty: jest.fn(
        (suffix: string) =>
            (str: string): string =>
                str !== '' ? `${str}${suffix}` : str,
    ),
    joinMetadataObjectsAndRemoveNulls: jest.fn(),
}));
jest.mock('@influxdata/influxdb-client', () => ({
    InfluxDB: jest.fn().mockImplementation(() => ({
        getWriteApi: jest.fn().mockImplementation(() => ({
            writePoint: jest.fn(),
        })),
        getQueryApi: jest.fn().mockImplementation(() => ({
            collectRows: jest.fn(),
        })),
    })),
}));
jest.mock('cross-fetch', () => {
    return {
        fetch: jest.fn().mockImplementation(() => {
            return {
                json: jest.fn().mockResolvedValue({
                    rates: {
                        USD: '1',
                        EUR: '0.85',
                        CNY: '6.45',
                    },
                }),
            };
        }),
    };
});

describe('/analytics', () => {
    let app: INestApplication;
    const mockJwtStrategy = new MockJwtStrategy();
    const mockInfluxService = new MockInfluxService();
    let moduleRef: any;
    let server;
    beforeAll(async () => {
        moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(InfluxService)
            .useValue(mockInfluxService)
            .overrideProvider(TokenConsumerService)
            .useValue(createMock<TokenConsumerService>())
            .overrideInterceptor(TokenRegisterInterceptor)
            .useValue(MockTokenRegister)
            .overrideGuard(AuthGuard('jwt'))
            .useValue(mockJwtStrategy)
            .overrideGuard(AuthGuard('oidc'))
            .useValue(mockJwtStrategy)
            .overrideProvider(getQueueOptionsToken())
            .useValue(createMock<QueueOptions>())
            .overrideProvider(getQueueToken('scheduler_queue'))
            .useValue(createMock<Queue>())
            .overrideProvider(getQueueToken('scheduler_billing_queue'))
            .useValue(createMock<Queue>())
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        await app.init();
        server = app.getHttpServer();
    });

    afterEach(() => {
        jest.clearAllMocks();
        return;
    });
    afterAll(async () => {
        await app.close();
        await moduleRef.close();
        await server.close();
    });
    describe('/business', () => {
        it('GET: Should correctly return values for analytics', async () => {
            const response = await request(server).get('/analytics/business').expect(200);
            expect(response.body).toEqual(
                expect.objectContaining({
                    message: expect.any(String),
                    data: expect.arrayContaining([
                        {
                            startDate: expect.any(String),
                            endDate: expect.any(String),
                            value: expect.any(String),
                            currency: 'USD',
                            type: 'mrr',
                        },
                        {
                            startDate: expect.any(String),
                            endDate: expect.any(String),
                            value: expect.any(String),
                            currency: 'USD',
                            type: 'arr',
                        },
                        {
                            startDate: expect.any(String),
                            endDate: expect.any(String),
                            value: expect.any(String),
                            type: 'churnRate',
                        },
                        {
                            startDate: expect.any(String),
                            endDate: expect.any(String),
                            value: expect.any(String),
                            currency: 'USD',
                            type: 'ltv',
                        },
                        {
                            startDate: expect.any(String),
                            endDate: expect.any(String),
                            value: expect.any(String),
                            currency: 'USD',
                            type: 'nrr',
                        },
                    ]),
                }),
            );
        });

        it('GET: Should properly sum up invoice totals if there is invoice data in the system', async () => {});
    });
});
