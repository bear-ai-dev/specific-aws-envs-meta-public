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
import { settingsGenerator } from '../fixtures/data/setting';
import { SettingInfluxRow } from '../../src/influx/entities/settingsInfluxTable.entity';
import { customerDBModelGenerator } from '../fixtures/data/customer';
import { productionBusinessID } from '../fixtures/data/user';
import { CustomerInfluxRow } from '../../src/influx/entities/customerInfluxRow';
import { AggregationPurpose } from '../../src/customer/dto/AggregationPurpose';
import { aggregateUsageGenerator } from '../fixtures/data/usage';
import { randomUUID } from 'crypto';
import { offeringDBModelGenerator } from '../fixtures/data/offering';
import { dimensionDBModelGenerator } from '../fixtures/data/dimension';
import { AppearanceOfferingPortalDto } from '../../src/portal/dto/PortalOfferingPageDto';
import { TokenConsumerService } from '../../src/token-consumer/token-consumer.service';
import { TokenRegisterInterceptor } from '../../src/interceptors/tokenRegisterInterceptor';
import { MockTokenRegister } from '../fixtures/module/mockTokenRegister';
import { OfferingInfluxRow } from '../../src/influx/entities/offeringInfluxTable.entity';
import { PaymentSchedule } from '../../src/dimensions/dto/create-dimension.dto';
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
describe('/portal', () => {
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
            .overrideInterceptor(TokenRegisterInterceptor)
            .useValue(MockTokenRegister)
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
    describe('/configuration', () => {
        test('GET: should return default settings for the checkout page if there is not any data in influx', async () => {
            const res = await request(server).get('/portal/configuration');
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.body.message).toBeDefined();
            expect(res.body.pages).toBeDefined();
            expect(res.body.pages.offering).toBeDefined();
        });

        test('GET: should return appearance settings for offerings', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [
                    {
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
            const res = await request(server).get('/portal/configuration');
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.body.message).toBeDefined();
            expect(res.body.pages).toBeDefined();
            expect(res.body.pages.offering).toBeDefined();
            expect(res.body.pages.offering.appearance).toBeDefined();
            expect(res.body.pages.offering.appearance.meteringcoBranding).toBe('#000000');
            expect(res.body.pages.offering.appearance.border).toBe('#000000');
            expect(res.body.pages.offering.appearance.background).toBe('#000000');
            expect(res.body.pages.offering.appearance.radius).toBe('10');
            expect(res.body.pages.offering.appearance.accent).toBe('#000000');
            expect(res.body.pages.offering.appearance.pricingTable).toBeDefined();
            expect(res.body.pages.offering.appearance.pricingTable.highlightedPrice).toBe('#b272e4');
            expect(res.body.pages.offering.appearance.pricingTable.featureListColor).toBe('#b272e4');
            expect(res.body.pages.offering.appearance.pricingTable.pricePlanBackground).toBe('#ffffff');
            expect(res.body.pages.offering.appearance.pricingTable.ctaBorder).toBe('#3670f2');
            expect(res.body.pages.offering.appearance.pricingTable.ctaBackground).toBe('#3670f2');
            expect(res.body.pages.offering.appearance.pricingTable.ctaText).toBe('#ffffff');
            expect(res.body.pages.offering.appearance.pricingTable.featureListIcon).toBe(
                '/icon:bold/interface-favorite-star-circle',
            );
            expect(res.body.pages.offering.appearance.pricingTable.showLogo).toBe(true);
        });
        test('PUT: should update appearance settings for offerings correctly', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
            );

            const res = await request(server)
                .put('/portal/configuration')
                .send({
                    pages: {
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
                    },
                });
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.body.message).toBeDefined();
            const { getPoint } = mockInfluxService;
            const { tag } = getPoint();
            expect(tag).toBeCalledWith(
                'pages',
                '{"invoice":{"enabled":true,"text":"Invoice"},"payment":{"enabled":false,"text":"Payment"},"offering":{"enabled":false,"text":"Plan","appearance":{"meteringcoBranding":"#000000","border":"#000000","background":"#000000","radius":"10","accent":"#000000","pricingTable":{"highlightedPrice":"#b272e4","featureListColor":"#b272e4","pricePlanBackground":"#ffffff","ctaBorder":"#3670f2","ctaBackground":"#3670f2","ctaText":"#ffffff","featureListIcon":"/icon:bold/interface-favorite-star-circle","showLogo":true}}}}',
            );
        });
        test('PUT: should update appearance settings when there already exists some values for the appearances', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [
                    {
                        ...settingsGenerator(),
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
            const res = await request(server)
                .put('/portal/configuration')
                .send({
                    pages: {
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
                    },
                });
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.body.message).toBeDefined();
            const { getPoint } = mockInfluxService;
            const { tag } = getPoint();

            expect(tag).toBeCalledWith(
                'pages',
                '{"invoice":{"enabled":true,"text":"Invoice"},"payment":{"enabled":false,"text":"Payment"},"offering":{"enabled":false,"text":"Plan","appearance":{"meteringcoBranding":"#000000","border":"#000000","background":"#000000","radius":"10","accent":"#000000","pricingTable":{"highlightedPrice":"#b272e4","featureListColor":"#b272e4","pricePlanBackground":"#ffffff","ctaBorder":"#3670f2","ctaBackground":"#3670f2","ctaText":"#ffffff","featureListIcon":"/icon:bold/interface-favorite-star-circle","showLogo":true}}}}',
            );
        });
        test('PUT: should update appearance settings when there already exists some values for the appearances and the request is missing some values', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [
                    {
                        ...settingsGenerator(),
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
            const res = await request(server)
                .put('/portal/configuration')
                .send({
                    pages: {
                        offering: {
                            appearance: {
                                pricingTable: {
                                    highlightedPrice: null,
                                    featureListColor: '#b272e4',
                                    showLogo: false,
                                },
                            },
                        },
                    },
                });
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(200);
            expect(res.body.message).toBeDefined();
            const { getPoint } = mockInfluxService;
            const { tag } = getPoint();

            expect(tag).toBeCalledWith(
                'pages',
                '{"invoice":{"enabled":true,"text":"Invoice"},"payment":{"enabled":false,"text":"Payment"},"offering":{"enabled":false,"text":"Plan","appearance":{"meteringcoBranding":"#11111","border":"#11111","background":"#11111","radius":"10","accent":"#11111","pricingTable":{"featureListColor":"#b272e4","pricePlanBackground":"#11111","ctaBorder":"#11111","ctaBackground":"#11111","ctaText":"#11111","featureListIcon":"/icon:bold/interface-square-square-triangle","showLogo":false}}}}',
            );
        });
        test("PUT: showLogo should only accept boolean values and should return 400 if it's not a boolean", async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [
                    {
                        ...settingsGenerator(),
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
            const res = await request(server)
                .put('/portal/configuration')
                .send({
                    pages: {
                        offering: {
                            appearance: {
                                pricingTable: {
                                    showLogo: 'true',
                                },
                            },
                        },
                    },
                });
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(400);
            expect(res.body.message).toBeDefined();
        });
        test("PUT: radius should only accept numeric string values and should return 400 if it's not a numeric string", async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [
                    {
                        ...settingsGenerator(),
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
            const res = await request(server)
                .put('/portal/configuration')
                .send({
                    pages: {
                        offering: {
                            appearance: {
                                radius: 'test',
                            },
                        },
                    },
                });
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(400);
            expect(res.body.message).toBeDefined();
        });
        test("PUT: meteringco branding should only accept hex value and should return 400 if it's not a hex value", async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [
                    {
                        ...settingsGenerator(),
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
            const res = await request(server)
                .put('/portal/configuration')
                .send({
                    pages: {
                        offering: {
                            appearance: {
                                meteringcoBranding: 'test',
                            },
                        },
                    },
                });
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
            expect(res.status).toBe(400);
            expect(res.body.message).toBeDefined();
        });
    });
    describe('/customer', () => {
        test('GET: should return customer information with paymentChannel', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
            );
            const customerDbModelData = customerDBModelGenerator();
            customerDbModelData.offeringId = undefined;
            customerDbModelData.creditBalance = undefined;
            customerDbModelData.businessID = productionBusinessID;
            mockInfluxService.getLatestCustomer.mockImplementationOnce(
                async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
            );
            const res = await request(server).get('/portal/customer');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                    message: 'Found customer billing information',
                    data: [
                        {
                            customerName: 'Cool Customer',
                            paymentChannel: 'Stripe',
                            email: 'test@meteringco.example',
                            address: JSON.parse(customerDbModelData.address as string),
                            taxExempt: 'none',
                            currency: 'USD',
                            creditBalance: '0',
                            invoices: [],
                            stripeAccountReady: false,
                        },
                    ],
                });
            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
        });
        test('POST: should return 400 if there is no body', async () => {
            await request(server).post('/portal/customer').expect(400);
            expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
        });
        test('POST: should commit a customer to influx if a correct body was commited', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
            );
            const res = await request(server)
                .post('/portal/customer')
                .send({ paymentChannel: 'Stripe', email: 'foo@bar.com', customerName: 'foobarTest' })
                .expect(201);

            expect(res.body).toEqual({
                portalUrl: 'https://fakeMeteringCoTester.com',
                customerId: expect.anything(),
                access_token: expect.anything(),
                message: 'Customer created',
            });
        });
        test('PUT: should update a customer and not remove its offering if there is one attached already', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
            );
            const customerDbModelData = customerDBModelGenerator();
            customerDbModelData.customerId = '12345';
            customerDbModelData.offeringId = '123456';
            customerDbModelData.creditBalance = undefined;
            customerDbModelData.businessID = productionBusinessID;
            mockInfluxService.getLatestCustomer.mockImplementationOnce(
                async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
            );
            mockInfluxService.getLatestOfferingConfig.mockImplementation(
                async (): Promise<OfferingInfluxRow[]> => [
                    {
                        ...offeringDBModelGenerator('7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', '1111'),
                        dimensionId_2222: '2222',
                        dimensionOverrides: JSON.stringify([{ dimensionId: '1111', consumptionPrice: '1338' }]),
                    },
                ],
            );
            const dimensionModel = dimensionDBModelGenerator();
            mockInfluxService.getSingleDimension.mockImplementation(async ({ dimensionId }) => {
                if (dimensionId === '1111') {
                    return [{ ...dimensionModel, dimensionId: '1111', paymentSchedule: PaymentSchedule.arrear }];
                } else {
                    return [
                        {
                            ...dimensionModel,
                            _value: 'override dimension name test',
                            dimensionId: '2222',
                            paymentSchedule: PaymentSchedule.arrear,
                        },
                    ];
                }
            });
            const res = await request(server)
                .put('/portal/customer')
                .send({
                    address: {
                        city: 'new york city',
                        countryCode: 'usa',
                        streetLineOne: '123 main st',
                        postalCode: '14522',
                        state: 'ny',
                    },
                })
                .expect(200);

            expect(res.body).toEqual({
                customerId: expect.anything(),
                message: 'Customer updated',
            });

            expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('offeringId', '123456');
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('offeringIds', JSON.stringify(['123456']));
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('businessID', productionBusinessID);
            expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                'address',
                JSON.stringify({
                    city: 'new york city',
                    countryCode: 'usa',
                    streetLineOne: '123 main st',
                    postalCode: '14522',
                    state: 'ny',
                }),
            );
        });
        describe('/usage', () => {
            test('GET: should return 404 if no customer is found in db', async () => {
                const res = await request(server).get('/portal/customer/usage');
                expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
                expect(res.status).toBe(404);
                expect(res.body.message).toBeDefined();
            });
            test('GET: should accept aggregation purpose as a query parameter', async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = undefined;
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                const res = await request(server)
                    .get('/portal/customer/usage')
                    .query({ aggregationPurpose: AggregationPurpose.METERING });
                expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
                expect(res.status).toBe(200);
                expect(res.body.message).toBeDefined();
                expect(res.body.data).toBeDefined();
            });
            test('GET: should return usage data if there is some inside of the DB', async () => {
                const customerId = randomUUID();
                const offeringId = randomUUID();
                const dimensionId = randomUUID();
                const customerDbModelData = customerDBModelGenerator();
                mockInfluxService.getLatestCustomer.mockResolvedValue([
                    { ...customerDbModelData, customerId, offeringId } as CustomerInfluxRow,
                ]);
                const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
                const dimensionDBModel = dimensionDBModelGenerator(dimensionId);
                mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
                mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
                    aggregateUsageGenerator(dimensionId, '535891e1-04c3-445f-bd87-af480c1722eb'),
                ]);
                mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
                const res = await request(server)
                    .get('/portal/customer/usage')
                    .query({ aggregationPurpose: AggregationPurpose.METERING });
                expect(mockLocalJWTStrategy.canActivate).toBeCalledTimes(1);
                expect(res.status).toBe(200);
                expect(res.body.message).toBeDefined();
                expect(res.body.data).toBeDefined();
                expect(res.body.data[0].dimensionId).toEqual(dimensionId);
                expect(res.body.data[0].value).toEqual('444.99');
                expect(mockInfluxService.getAggregateUsageForDimension).toBeCalledTimes(1);
                expect(mockInfluxService.getAggregateUsageForDimension).toBeCalledWith(
                    expect.objectContaining({ aggregationPurpose: AggregationPurpose.METERING }),
                );
            });
        });
    });

    describe('/token', () => {
        test('GET: returns a business token which can be used to get the checkout page settings', async () => {
            const res = await request(server).post('/portal/token');

            expect(res.status).toBe(201);
            expect(res.body.access_token).toBeDefined();
            expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        });
    });
});
