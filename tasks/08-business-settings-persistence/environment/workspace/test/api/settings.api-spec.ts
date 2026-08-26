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
import { LocalJWTAuthGuard } from '../../src/authz/jwt-local.gaurd';
import { settingsGenerator, simpleSetting } from '../fixtures/data/setting';
import { SettingInfluxRow } from '../../src/influx/entities/settingsInfluxTable.entity';
import { AppearanceOfferingPortalDto } from '../../src/portal/dto/PortalOfferingPageDto';
import { TokenConsumerService } from '../../src/token-consumer/token-consumer.service';
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
    suffixIfNotEmpty: jest.fn(),
    joinMetadataObjectsAndRemoveNulls: jest.fn(),
}));

describe('/settings', () => {
    let app: INestApplication;
    const mockJwtStrategy = new MockJwtStrategy();
    const mockLocalJWTStrategy = new MockJwtStrategy();
    const mockInfluxService = new MockInfluxService();
    let moduleRef: any;
    let server;
    beforeAll(async () => {
        process.env.JWT_SECRET = 'test';
        moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        })
            .overrideProvider(InfluxService)
            .useValue(mockInfluxService)
            .overrideProvider(TokenConsumerService)
            .useValue(createMock<TokenConsumerService>())
            .overrideGuard(AuthGuard('jwt'))
            .useValue(mockJwtStrategy)
            .overrideGuard(AuthGuard('oidc'))
            .useValue(mockJwtStrategy)
            .overrideGuard(LocalJWTAuthGuard)
            .useValue(mockLocalJWTStrategy)
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
        delete process.env.JWT_SECRET;
        await app.close();
        await moduleRef.close();
        await server.close();
    });
    describe('/settings', () => {
        test('GET: should return default settings for the checkout page if there is not any data in influx', async () => {
            const res = await request(server).get('/settings');
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            const resBody = res.body[0];
            expect(resBody.pages).toBeDefined();
            expect(resBody.pages.offering).toBeDefined();
        });

        test('GET: should return settings', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [
                    {
                        ...simpleSetting,
                        ...settingsGenerator(),
                        pages: JSON.stringify({
                            offering: {
                                appearance: {
                                    meteringcoBranding: '#000000',
                                    border: '#000000',
                                    background: '#000000',
                                    radius: '10',
                                    accent: '#000000',
                                    pricingTable: {
                                        highlightedPrice: '#b272e4',
                                        featureListColor: '#b272e4',
                                        pricePlanBackground: '#ffffff',
                                        ctaBorder: '#3670f2',
                                        ctaBackground: '#3670f2',
                                        ctaText: '#ffffff',
                                        featureListIcon: '/icon:bold/interface-favorite-star-circle',
                                        showLogo: true,
                                    },
                                } as AppearanceOfferingPortalDto,
                            },
                        }),
                    },
                ],
            );
            const res = await request(server).get('/settings');
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.body.length).toBe(1);
            const resBody = res.body[0];
            expect(resBody.businessName).toBe('Cool Corp');
            expect(resBody.addressLine1).toBe('123 Main St');
            expect(resBody.addressLine2).toBe('Suite 1');
            expect(resBody.city).toBe('San Francisco');
            expect(resBody.state).toBe('CA');
            expect(resBody.country).toBe('USA');
            expect(resBody.postalCode).toBe('94105');
            expect(resBody.vatId).toBe('123456789');
            expect(resBody.logoUrl).toBe(
                'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png',
            );
            expect(resBody.pages).toBeDefined();
            expect(resBody.pages.offering).toBeDefined();
            expect(resBody.pages.offering.appearance).toBeDefined();
            expect(resBody.pages.offering.appearance.meteringcoBranding).toBe('#000000');
            expect(resBody.pages.offering.appearance.border).toBe('#000000');
            expect(resBody.pages.offering.appearance.background).toBe('#000000');
            expect(resBody.pages.offering.appearance.radius).toBe('10');
            expect(resBody.pages.offering.appearance.accent).toBe('#000000');
            expect(resBody.pages.offering.appearance.pricingTable).toBeDefined();
            expect(resBody.pages.offering.appearance.pricingTable.highlightedPrice).toBe('#b272e4');
            expect(resBody.pages.offering.appearance.pricingTable.featureListColor).toBe('#b272e4');
            expect(resBody.pages.offering.appearance.pricingTable.pricePlanBackground).toBe('#ffffff');
            expect(resBody.pages.offering.appearance.pricingTable.ctaBorder).toBe('#3670f2');
            expect(resBody.pages.offering.appearance.pricingTable.ctaBackground).toBe('#3670f2');
            expect(resBody.pages.offering.appearance.pricingTable.ctaText).toBe('#ffffff');
            expect(resBody.pages.offering.appearance.pricingTable.featureListIcon).toBe(
                '/icon:bold/interface-favorite-star-circle',
            );
            expect(resBody.pages.offering.appearance.pricingTable.showLogo).toBe(true);
        });
        describe('/profile', () => {
            test('GET: should return profile information if its found', async () => {
                mockInfluxService.getLatestSettings.mockImplementationOnce(
                    async (): Promise<SettingInfluxRow[]> => [
                        {
                            ...simpleSetting,
                            ...settingsGenerator(),
                            stripeAccountId: 'fakeStripeAccountId',
                            redirectionUrl: 'https://www.google.com',
                            pages: JSON.stringify({
                                offering: {
                                    appearance: {
                                        meteringcoBranding: '#11111',
                                        border: '#11111',
                                        background: '#11111',
                                        radius: '10',
                                        accent: '#11111',
                                        pricingTable: {
                                            highlightedPrice: '#11111',
                                            featureListColor: '#11111',
                                            pricePlanBackground: '#11111',
                                            ctaBorder: '#11111',
                                            ctaBackground: '#11111',
                                            ctaText: '#11111',
                                            featureListIcon: '/icon:bold/interface-square-square-triangle',
                                            showLogo: true,
                                        },
                                    } as AppearanceOfferingPortalDto,
                                },
                            }),
                        },
                    ],
                );
                const res = await request(server).get('/settings/profile');
                expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
                expect(res.status).toBe(200);
                const {
                    body: {
                        data: [settings],
                    },
                } = res;
                expect(settings.addressLine1).toBe('123 Main St');
                expect(settings.addressLine2).toBe('Suite 1');
                expect(settings.city).toBe('San Francisco');
                expect(settings.state).toBe('CA');
                expect(settings.country).toBe('USA');
                expect(settings.postalCode).toBe('94105');
                expect(settings.stripeAccountId).toBe('fakeStripeAccountId');
                expect(settings.redirectionUrl).toBe('https://www.google.com');
            });
        });
    });
});
