import request from 'supertest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { InfluxService } from '../../src/influx/influx.service';
import { AuthGuard } from '@nestjs/passport';
import { MockInfluxService } from '../fixtures/module/mockInfluxService';
import { MockJwtStrategy } from '../fixtures/module/mockJwtStrategy';
import { CustomerInfluxRow } from '../../src/influx/entities/customerInfluxRow';
import { customerDBModelGenerator } from '../fixtures/data/customer';
import { productionBusinessID } from '../fixtures/data/user';
import { getQueueOptionsToken, getQueueToken } from '@nestjs/bull';
import { createMock } from '@golevelup/ts-jest';
import { Queue, QueueOptions } from 'bull';
import { SettingInfluxRow } from '../../src/influx/entities/settingsInfluxTable.entity';
import { settingsGenerator } from '../fixtures/data/setting';
import { DatetimeUtils } from '../../src/utils/datetime';
import { offeringDBModelGenerator } from '../fixtures/data/offering';
import { OfferingInfluxRow } from '../../src/influx/entities/offeringInfluxTable.entity';
import { dimensionDBModelGenerator } from '../fixtures/data/dimension';
import { PaymentSchedule } from '../../src/dimensions/dto/create-dimension.dto.js';
import { CreateUsageDto } from '../../src/usage/dto/create-usage.dto';
import { CreateCustomerDto } from '../../src/customer/dto/create-customer.dto';
import { OfferingIdExistsRule } from '../../src/offering/dto/offeringIdExists';
import { useContainer } from 'class-validator';
import { OfferingType } from '../../src/offering/entities/OfferingType';
import { TokenConsumerService } from '../../src/token-consumer/token-consumer.service';
import { TokenRegisterInterceptor } from '../../src/interceptors/tokenRegisterInterceptor';
import { MockTokenRegister } from '../fixtures/module/mockTokenRegister';
import { randomUUID } from 'crypto';
import { SchedulerModule } from '../../src/scheduler/scheduler.module.js';
import { SchedulerService } from '../../src/scheduler/scheduler.service.js';
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

describe('/customers', () => {
    let app: INestApplication;
    const mockJwtStrategy = new MockJwtStrategy();
    const mockInfluxService = new MockInfluxService();
    const mockBillingQueue = createMock<Queue>();
    const mockScheduler = createMock<SchedulerService>();

    const mockOfferingValidator = createMock<OfferingIdExistsRule>();
    let moduleRef: any;
    //twinny make a new variable called foobar

    let server;
    beforeAll(async () => {
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
            .overrideInterceptor(TokenRegisterInterceptor)
            .useValue(MockTokenRegister)
            .overrideProvider(getQueueOptionsToken())
            .useValue(createMock<QueueOptions>())
            .overrideProvider(getQueueToken('scheduler_queue'))
            .useValue(createMock<Queue>())
            .overrideProvider(getQueueToken('scheduler_billing_queue'))
            .useValue(mockBillingQueue)
            .overrideProvider(SchedulerService)
            .useValue(mockScheduler)
            .compile();

        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
        useContainer(app.select(AppModule), { fallbackOnErrors: true });
        await app.init();
        server = app.getHttpServer();
    });
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2023-08-18'));
    });
    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    it(`GET: Customers with a fresh account should call auth`, async () => {
        await request(server).get('/customers').expect(200);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
    });

    it(`GET: Customers with a fresh account`, async () => {
        const res = await request(server).get('/customers').expect(200).expect({
            data: [],
            message: 'No Customers Found',
        });
        return res;
    });
    it('POST: should call auth', async () => {
        const res = await request(server).post('/customers').expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        return res;
    });
    it('POST: should return 400 if no body is sent', async () => {
        const res = await request(server).post('/customers').expect(400);
        return res;
    });
    it("POST: should return a stripe URL if the created customer is a stripe customer and the user's business is a setup for stripe", async () => {
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        const res = await request(server)
            .post('/customers')
            .send({ paymentChannel: 'Stripe', email: 'foo@bar.com', customerName: 'foobarTest' })
            .expect(201);

        expect(res.body).toEqual({
            portalUrl: 'https://fakeMeteringCoTester.com',
            customerId: expect.anything(),
            message: 'New customer added',
        });
    });
    it('POST: Should return without a portal url for manual customers', async () => {
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        const res = await request(server)
            .post('/customers')
            .send({ paymentChannel: 'manual', email: 'foo@bar.com', customerName: 'foobarTest' })
            .expect(201);

        expect(res.body).toEqual({
            customerId: expect.anything(),
            message: 'New customer added',
        });
    });
    it('POST: Should store the passed in customerId', async () => {
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        const res = await request(server)
            .post('/customers')
            .send({ paymentChannel: 'manual', email: 'foo@bar.com', customerName: 'foobarTest', customerId: 'barfoo' })
            .expect(201);

        expect(res.body).toEqual({
            customerId: 'barfoo',
            message: 'New customer added',
        });
        const { tag } = mockInfluxService.getPoint();
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        expect(tag).toBeCalledWith('customerId', 'barfoo');
    });
    it('POST: Should create a customerId if one is not passed in', async () => {
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        const res = await request(server)
            .post('/customers')
            .send({ paymentChannel: 'manual', email: 'foo@bar.com', customerName: 'foobarTest' })
            .expect(201);

        expect(res.body).toEqual({
            customerId: expect.anything(),
            message: 'New customer added',
        });
        const { tag } = mockInfluxService.getPoint();
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        expect(tag).toBeCalledWith('customerId', expect.anything());
    });
    it('POST: Should create an offering with usage override if usage is passed in for the dimensions', async () => {
        mockOfferingValidator.validate.mockResolvedValue(true);
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        mockInfluxService.getLatestOfferingConfig.mockImplementation(
            async (): Promise<OfferingInfluxRow[]> => [
                { ...offeringDBModelGenerator('455dde28-faf5-4273-a793-3e7ae99bcc60', '1111') },
            ],
        );
        const dimensionModel = dimensionDBModelGenerator();
        mockInfluxService.getSingleDimension.mockImplementation(async () => [
            { ...dimensionModel, dimensionId: '1111', paymentSchedule: PaymentSchedule.upfront },
        ]);
        const usageOverride: CreateUsageDto[] = [
            {
                customerId: '12345',
                dimensionId: '1111',
                recordValue: '100',
            } as CreateUsageDto,
        ];
        const res = await request(server)
            .post('/customers')
            .send({
                paymentChannel: 'manual',
                email: 'foo@bar.com',
                customerName: 'foobarTest',
                offeringId: '455dde28-faf5-4273-a793-3e7ae99bcc60',
                usage: usageOverride,
            } as CreateCustomerDto);
        expect(res?.status).toBe(201);

        expect(res.body).toEqual({
            customerId: expect.anything(),
            message: 'New customer added',
        });
        const { loadPoints, getPoint } = mockInfluxService;
        const { tag } = getPoint();
        expect(loadPoints).toBeCalledTimes(4);
        expect(tag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([{ name: 'dimensionName Cool Value - Count - testOffering', quantity: 10, unitCost: 20 }]),
        );
        expect(tag).toBeCalledWith('customerId', expect.anything());
        expect(tag).toBeCalledWith('offeringId', '455dde28-faf5-4273-a793-3e7ae99bcc60');
    });
    it('POST: Should create an customer with a subscription offering and usage override if usage is passed in for the dimensions with upfront payment', async () => {
        mockOfferingValidator.validate.mockResolvedValue(true);
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        mockInfluxService.getLatestOfferingConfig.mockImplementation(
            async (): Promise<OfferingInfluxRow[]> => [
                {
                    ...offeringDBModelGenerator('455dde28-faf5-4273-a793-3e7ae99bcc60', '1111'),
                    offeringType: OfferingType.subscription,
                    subscriptionPrice: '19.99',
                },
            ],
        );
        const dimensionModel = dimensionDBModelGenerator();
        mockInfluxService.getSingleDimension.mockImplementation(async () => [
            { ...dimensionModel, dimensionId: '1111', paymentSchedule: PaymentSchedule.upfront },
        ]);
        const usageOverride: CreateUsageDto[] = [
            {
                customerId: '12345',
                dimensionId: '1111',
                recordValue: '100',
            } as CreateUsageDto,
        ];
        const res = await request(server)
            .post('/customers')
            .send({
                paymentChannel: 'manual',
                email: 'foo@bar.com',
                customerName: 'foobarTest',
                offeringId: '455dde28-faf5-4273-a793-3e7ae99bcc60',
                usage: usageOverride,
            } as CreateCustomerDto);
        expect(res?.status).toBe(201);

        expect(res.body).toEqual({
            customerId: expect.anything(),
            message: 'New customer added',
        });
        const { loadPoints, getPoint } = mockInfluxService;
        const { tag } = getPoint();
        expect(loadPoints).toBeCalledTimes(4);
        expect(tag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                { name: 'testOffering', quantity: 1, unitCost: 9.03, description: 'Subscription' },
                { name: 'dimensionName Cool Value - Count - testOffering', quantity: 10, unitCost: 9.03 },
            ]),
        );
        expect(tag).toBeCalledWith('customerId', expect.anything());
        expect(tag).toBeCalledWith('offeringId', '455dde28-faf5-4273-a793-3e7ae99bcc60');
    });
    it('POST: Should create an offering with usage override if usage is passed in for multiple dimensions', async () => {
        mockOfferingValidator.validate.mockResolvedValue(true);
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        mockInfluxService.getLatestOfferingConfig.mockImplementation(
            async (): Promise<OfferingInfluxRow[]> => [
                {
                    ...offeringDBModelGenerator('455dde28-faf5-4273-a793-3e7ae99bcc60', '1111'),
                    dimensionId_2222: '2222',
                },
            ],
        );
        const dimensionModel = dimensionDBModelGenerator();
        mockInfluxService.getSingleDimension.mockImplementation(async ({ dimensionId }) => {
            if (dimensionId === '1111') {
                return [{ ...dimensionModel, dimensionId: '1111', paymentSchedule: PaymentSchedule.upfront }];
            } else {
                return [
                    {
                        ...dimensionModel,
                        _value: 'override dimension name test',
                        dimensionId: '2222',
                        paymentSchedule: PaymentSchedule.upfront,
                    },
                ];
            }
        });
        const usageOverride: CreateUsageDto[] = [
            {
                customerId: '12345',
                dimensionId: '1111',
                recordValue: '100',
            } as CreateUsageDto,
            {
                customerId: '12345',
                dimensionId: '2222',
                recordValue: '100',
            } as CreateUsageDto,
        ];
        const res = await request(server)
            .post('/customers')
            .send({
                paymentChannel: 'manual',
                email: 'foo@bar.com',
                customerName: 'foobarTest',
                offeringId: '455dde28-faf5-4273-a793-3e7ae99bcc60',
                usage: usageOverride,
            } as CreateCustomerDto);
        expect(res?.status).toBe(201);

        expect(res.body).toEqual({
            customerId: expect.anything(),
            message: 'New customer added',
        });
        const { loadPoints, getPoint } = mockInfluxService;
        const { tag } = getPoint();
        expect(loadPoints).toBeCalledTimes(5);
        expect(tag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                { name: 'dimensionName Cool Value - Count - testOffering', quantity: 10, unitCost: 20 },
                { name: 'override dimension name test - Count - testOffering', quantity: 10, unitCost: 20 },
            ]),
        );
        expect(tag).toBeCalledWith('customerId', expect.anything());
        expect(tag).toBeCalledWith('offeringId', '455dde28-faf5-4273-a793-3e7ae99bcc60');
    });
    it('POST: Should not create a customer if there are duplicate dimension Ids in the usage records', async () => {
        mockOfferingValidator.validate.mockResolvedValue(true);
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        mockInfluxService.getLatestOfferingConfig.mockImplementation(
            async (): Promise<OfferingInfluxRow[]> => [
                {
                    ...offeringDBModelGenerator('455dde28-faf5-4273-a793-3e7ae99bcc60', '1111'),
                    dimensionId_2222: '2222',
                },
            ],
        );
        const dimensionModel = dimensionDBModelGenerator();
        mockInfluxService.getSingleDimension.mockImplementation(async ({ dimensionId }) => {
            if (dimensionId === '1111') {
                return [{ ...dimensionModel, dimensionId: '1111', paymentSchedule: PaymentSchedule.upfront }];
            } else {
                return [
                    {
                        ...dimensionModel,
                        _value: 'override dimension name test',
                        dimensionId: '2222',
                        paymentSchedule: PaymentSchedule.upfront,
                    },
                ];
            }
        });
        const usageOverride: CreateUsageDto[] = [
            {
                customerId: '12345',
                dimensionId: '1111',
                recordValue: '100',
            } as CreateUsageDto,
            {
                customerId: '12345',
                dimensionId: '1111',
                recordValue: '100',
            } as CreateUsageDto,
        ];
        const res = await request(server)
            .post('/customers')
            .send({
                paymentChannel: 'manual',
                email: 'foo@bar.com',
                customerName: 'foobarTest',
                offeringId: '455dde28-faf5-4273-a793-3e7ae99bcc60',
                usage: usageOverride,
            } as CreateCustomerDto);
        expect(res?.status).toBe(400);

        const { loadPoints } = mockInfluxService;
        expect(loadPoints).toBeCalledTimes(0);
    });
    it('POST: Should throw an error if the customerId is already in use', async () => {
        const customerDbModelData = customerDBModelGenerator();
        customerDbModelData.customerId = 'barfoo';
        customerDbModelData.businessID = productionBusinessID;
        mockInfluxService.getLatestCustomer.mockImplementationOnce(
            async ({ customerId }): Promise<CustomerInfluxRow[]> => {
                if (customerId === 'barfoo') {
                    return [customerDbModelData];
                } else {
                    return [];
                }
            },
        );
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        const res = await request(server)
            .post('/customers')
            .send({ paymentChannel: 'manual', email: 'foo@bar.com', customerName: 'foobarTest', customerId: 'barfoo' })
            .expect(400);

        expect(res.body).toEqual(
            expect.objectContaining({
                message: 'Failed to create customer. customerId: barfoo already exists.',
            }),
        );
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: Should create a customer with an offering and apply the dimension overrides on the offering', async () => {
        mockOfferingValidator.validate.mockResolvedValue(true);
        mockInfluxService.getLatestSettings.mockImplementationOnce(
            async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
        );
        mockInfluxService.getLatestOfferingConfig.mockImplementation(
            async (): Promise<OfferingInfluxRow[]> => [
                {
                    ...offeringDBModelGenerator('455dde28-faf5-4273-a793-3e7ae99bcc60', '1111'),
                    dimensionId_2222: '2222',
                    dimensionOverrides: JSON.stringify([{ dimensionId: '1111', consumptionPrice: '1338' }]),
                },
            ],
        );
        const dimensionModel = dimensionDBModelGenerator();
        mockInfluxService.getSingleDimension.mockImplementation(async ({ dimensionId }) => {
            if (dimensionId === '1111') {
                return [{ ...dimensionModel, dimensionId: '1111', paymentSchedule: PaymentSchedule.upfront }];
            } else {
                return [
                    {
                        ...dimensionModel,
                        _value: 'override dimension name test',
                        dimensionId: '2222',
                        paymentSchedule: PaymentSchedule.upfront,
                    },
                ];
            }
        });
        const res = await request(server)
            .post('/customers')
            .send({
                paymentChannel: 'manual',
                email: 'foo@bar.com',
                customerName: 'foobarTest',
                offeringId: '455dde28-faf5-4273-a793-3e7ae99bcc60',
            } as CreateCustomerDto);

        expect(res?.status).toBe(201);
        expect(res.body).toEqual({
            customerId: expect.anything(),
            message: 'New customer added',
        });
        const { loadPoints } = mockInfluxService;
        expect(loadPoints).toBeCalledTimes(2);
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
    describe('/:customerId', () => {
        beforeEach(() => {
            jest.clearAllMocks();
        });
        it(`GET: should 404 with no data`, async () => {
            await request(server).get('/customers/12345').expect(404);
            expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
        });
        it(`PUT: should not accept unenrollOffering string and offeringId in the same request`, async () => {
            mockInfluxService.getLatestOfferingConfig.mockImplementation(
                async (): Promise<OfferingInfluxRow[]> => [
                    {
                        ...offeringDBModelGenerator('177735fe-5d06-49a7-a8fb-f5da11773345', '1111'),
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
            await request(server)
                .put('/customers/12345')
                .send({
                    offeringId: '177735fe-5d06-49a7-a8fb-f5da11773345',
                    unenrollOffering: 'ee7987c6-8809-42f7-8e5e-603fba9ca0a3',
                })
                .expect(400);
            expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(0);
            expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
        });
        it(`PUT: should not accept unenrollOffering string  if the string doesnt exist`, async () => {
            await request(server)
                .put('/customers/12345')
                .send({
                    unenrollOffering: 'ee7987c6-8809-42f7-8e5e-603fba9ca0a3',
                })
                .expect(404);
            expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
            expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
        });
        it('GET: Customer with incomplete Stripe info', async () => {
            mockInfluxService.getLatestSettings.mockImplementationOnce(
                async (): Promise<SettingInfluxRow[]> => [settingsGenerator()],
            );
            mockInfluxService.getLatestCustomer.mockImplementationOnce(
                async (): Promise<CustomerInfluxRow[]> => [
                    {
                        ...customerDBModelGenerator(),
                        paymentChannelOptions_stripeCustomerId: 'badAccount',
                    },
                ],
            );

            const res = await request(server).get('/customers/12345').expect(200);
            expect(res.body).toEqual({
                message: 'Found Customer',
                data: [
                    expect.objectContaining({
                        paymentChannel: 'Stripe',
                        paymentChannelOptions: {
                            stripeCustomerId: 'badAccount',
                        },
                        stripeAccountReady: false,
                    }),
                ],
            });
        });
        it(`GET: should return data if the db returns a value`, async () => {
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
            const res = await request(server)
                .get('/customers/12345')
                .expect(200)
                .expect({
                    message: 'Found Customer',
                    data: [
                        {
                            customerId: 'some-customer-id',
                            customerName: 'Cool Customer',
                            paymentChannel: 'Stripe',
                            children: [],
                            parent: {},
                            paymentChannelOptions: {
                                stripeCustomerId: 'foobar',
                            },
                            email: 'test@meteringco.example',
                            address: JSON.parse(customerDbModelData.address as string),
                            customerVatId: 'GB VAT 123456789',
                            taxExempt: 'none',
                            currency: 'USD',
                            creditBalance: '0',
                            metadata: JSON.parse(customerDbModelData.metadata as string),
                            invoices: [],
                            offeringEnrollmentDate: '2020-12-31T23:59:59.999Z',
                            stripeAccountReady: false,
                        },
                    ],
                });
            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
            return res;
        });
        it(`PUT: should not update the customerId`, async () => {
            const customerDbModelData = customerDBModelGenerator();
            customerDbModelData.customerId = '12345';
            customerDbModelData.offeringId = undefined;
            customerDbModelData.creditBalance = undefined;
            customerDbModelData.businessID = productionBusinessID;
            mockInfluxService.getLatestCustomer.mockImplementationOnce(
                async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
            );
            const res = await request(server)
                .put('/customers/12345')
                .send({ customerId: 'foobar' })
                .expect(200)
                .expect({
                    message: 'Customer updated added',
                    customerId: '12345',
                });
            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
            return res;
        });
        it(`PUT: should store a new offeringId if removePriorOffering is set to false`, async () => {
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
                .put('/customers/12345')
                .send({ offeringId: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', removePriorOffering: false })
                .expect(200)
                .expect({
                    message: 'Customer updated added',
                    customerId: '12345',
                });

            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
            expect(mockInfluxService.loadPoints).toBeCalledTimes(2);

            expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
            expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                'offeringId',
                '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f',
            );
            expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                'offeringIds',
                JSON.stringify(['7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', '123456']),
            );
            return res;
        });
        it(`PUT: not unenroll a customer from an offering if the new offeringId is undefined`, async () => {
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
                .put('/customers/12345')
                .send({ customerName: 'Foobar' })
                .expect(200)
                .expect({
                    message: 'Customer updated added',
                    customerId: '12345',
                });

            expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);

            expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('offeringId', '123456');
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('offeringIds', JSON.stringify(['123456']));
            expect(mockInfluxService.getPoint().stringField).toBeCalledWith('customerName', 'Foobar');
            return res;
        });
        it(`PUT: Usage should only take an array`, async () => {
            const customerDbModelData = customerDBModelGenerator();
            customerDbModelData.offeringId = undefined;
            customerDbModelData.creditBalance = undefined;
            customerDbModelData.businessID = productionBusinessID;
            const res = await request(server)
                .put('/customers/12345')
                .send({ usage: 'foobar' })
                .expect(400)
                .expect({
                    message: ['usage must be an array'],
                    statusCode: 400,
                    error: 'Bad Request',
                });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
            return res;
        });
        it(`DELETE: should soft delete the customer`, async () => {
            const customerDbModelData = customerDBModelGenerator();
            customerDbModelData.offeringId = undefined;
            customerDbModelData.creditBalance = undefined;
            customerDbModelData.businessID = productionBusinessID;
            mockInfluxService.getLatestCustomer.mockImplementationOnce(
                async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
            );
            const res = await request(server).delete('/customers/12345').expect(200);
            expect(res.body).toEqual({
                message: 'Deleted Customer',
                customerId: '12345',
            });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('softDelete', 'deleted');
        });
        it('DELETE: should 404 if there is no customer in the DB', async () => {
            mockInfluxService.getLatestCustomer.mockImplementation(async (): Promise<CustomerInfluxRow[]> => []);
            const res = await request(server).delete('/customers/12345').expect(404);
            expect(res.body).toEqual({
                error: 'Not Found',
                message: 'Customer with ID: 12345 not found',
                statusCode: 404,
            });
        });
        it("GET: should return a free trial end date if it's set", async () => {
            const customerDbModelData = customerDBModelGenerator();
            customerDbModelData.offeringId = '12345';
            customerDbModelData.creditBalance = undefined;
            customerDbModelData.businessID = productionBusinessID;
            customerDbModelData.freeTrialEndDate = '2019-10-11T11:29:34.441Z';
            mockInfluxService.getLatestCustomer.mockImplementationOnce(
                async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
            );
            const res = await request(server).get('/customers/12345').expect(200);
            expect(res.body).toEqual(
                expect.objectContaining({
                    data: [
                        {
                            customerId: 'some-customer-id',
                            customerName: 'Cool Customer',
                            paymentChannel: 'Stripe',
                            paymentChannelOptions: { stripeCustomerId: 'foobar' },
                            email: 'test@meteringco.example',
                            address: {
                                countryCode: 'US',
                                postalCode: '90210',
                                city: 'Beverly Hills',
                                streetLineOne: '1234 Main St',
                                streetLineTwo: 'Apt 1',
                                state: 'NY',
                            },
                            customerVatId: 'GB VAT 123456789',
                            taxExempt: 'none',
                            offeringId: '12345',
                            offeringIds: ['12345'],
                            freeTrialEndDate: '2019-10-11T11:29:34.441Z',
                            currency: 'USD',
                            creditBalance: '0',
                            offeringEnrollmentDate: '2020-12-31T23:59:59.999Z',
                            metadata: { foo: 'bar' },
                            invoices: [],
                            children: [],
                            parent: {},
                            offering: {
                                dimensions: [
                                    {
                                        dimensionId: '1111',
                                        usageIncrement: '10',
                                        rounding: 'ceiling',
                                        consumptionPrice: '20.00',
                                        consumptionUnit: { unit: 'count', type: 'count-based' },
                                        aggregationInterval: 'hour',
                                        paymentSchedule: 'arrear',
                                        dimensionName: 'dimensionName Cool Value',
                                    },
                                    {
                                        dimensionId: '2222',
                                        usageIncrement: '10',
                                        rounding: 'ceiling',
                                        consumptionPrice: '20.00',
                                        consumptionUnit: { unit: 'count', type: 'count-based' },
                                        aggregationInterval: 'hour',
                                        paymentSchedule: 'arrear',
                                        dimensionName: 'override dimension name test',
                                    },
                                ],
                                offeringId: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f',
                                offeringName: 'testOffering',
                                currency: 'USD',
                                offeringType: 'usage-based',
                                billingCycle: 'monthly',
                                offeringVisibility: 'public',
                                dimensionOverrides: [{ dimensionId: '1111', consumptionPrice: '1338' }],
                            },
                            enrollments: [
                                {
                                    offering: {
                                        dimensions: [
                                            {
                                                dimensionId: '1111',
                                                usageIncrement: '10',
                                                rounding: 'ceiling',
                                                consumptionPrice: '20.00',
                                                consumptionUnit: { unit: 'count', type: 'count-based' },
                                                aggregationInterval: 'hour',
                                                paymentSchedule: 'arrear',
                                                dimensionName: 'dimensionName Cool Value',
                                            },
                                            {
                                                dimensionId: '2222',
                                                usageIncrement: '10',
                                                rounding: 'ceiling',
                                                consumptionPrice: '20.00',
                                                consumptionUnit: { unit: 'count', type: 'count-based' },
                                                aggregationInterval: 'hour',
                                                paymentSchedule: 'arrear',
                                                dimensionName: 'override dimension name test',
                                            },
                                        ],
                                        offeringId: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f',
                                        offeringName: 'testOffering',
                                        currency: 'USD',
                                        offeringType: 'usage-based',
                                        billingCycle: 'monthly',
                                        offeringVisibility: 'public',
                                        dimensionOverrides: [{ dimensionId: '1111', consumptionPrice: '1338' }],
                                    },
                                    offeringEnrollmentDate: '2020-12-31T23:59:59.999Z',
                                    overrides: {
                                        freeTrialEndDate: '2019-10-11T11:29:34.441Z',
                                        dimensionOverrides: [{ dimensionId: '1111', consumptionPrice: '1338' }],
                                    },
                                },
                            ],
                        },
                    ],
                    message: 'Found Customer',
                }),
            );
        });

        describe('/freeTrial', () => {
            it(`PUT: should update the free trial date from a previously set date`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = '12345';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                customerDbModelData.freeTrialEndDate = '2019-10-11T11:29:34.441Z';
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                mockInfluxService.getLatestOfferingConfig.mockImplementation(
                    async (): Promise<OfferingInfluxRow[]> => [{ ...offeringDBModelGenerator('12345', '1111') }],
                );
                mockInfluxService.getSingleDimension.mockImplementation(async () => [
                    { ...dimensionDBModelGenerator() },
                ]);
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                const tomorrow = DatetimeUtils.endOfTomorrow(new Date());
                const res = await request(server)
                    .put('/customers/12345/freeTrial')
                    .send({ freeTrialEndDate: tomorrow.toISOString() })
                    .expect(200)
                    .expect({
                        message: 'Free trial end date updated',
                        customerId: '12345',
                    });
                expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
                expect(mockInfluxService.getPoint().tag).toBeCalledWith('freeTrialEndDate', tomorrow.toISOString());
                expect(mockInfluxService.getPoint().tag).toBeCalledWith('offeringId', '12345');
                expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
                return res;
            });
        });

        describe('/enrollment', () => {
            it(`PUT: should enroll a customer in an offering`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = undefined;
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                mockInfluxService.getLatestOfferingConfig.mockImplementation(
                    async (): Promise<OfferingInfluxRow[]> => [
                        { ...offeringDBModelGenerator('9fdb9e3b-5f24-4f46-aff1-3b98c40e330c', '1111') },
                    ],
                );
                mockInfluxService.getSingleDimension.mockImplementation(async () => [
                    { ...dimensionDBModelGenerator() },
                ]);
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                const res = await request(server)
                    .put('/customers/12345/enrollment')
                    .send({ offeringId: '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c' });
                expect(res?.status).toBe(200);
                expect(res.body).toEqual({
                    message: 'Customer updated added',
                    customerId: '12345',
                });
                expect(mockInfluxService.loadPoints).toBeCalledTimes(2);
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'offeringId',
                    '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c',
                );
                expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
                return res;
            });
            it(`PUT: should unenroll a customer from an offering if unenrollOffering is passed with a valid offeringId`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = '12345';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                mockInfluxService.getLatestOfferingConfig.mockImplementation(
                    async (): Promise<OfferingInfluxRow[]> => [
                        { ...offeringDBModelGenerator('9fdb9e3b-5f24-4f46-aff1-3b98c40e330c', '1111') },
                    ],
                );
                mockInfluxService.getSingleDimension.mockImplementation(async () => [
                    { ...dimensionDBModelGenerator() },
                ]);
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                const res = await request(server)
                    .put('/customers/12345/enrollment')
                    .send({ unenrollOffering: '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c' });
                expect(res?.status).toBe(200);
                expect(res.body).toEqual({
                    message: 'Customer updated added',
                    customerId: '12345',
                });
                expect(mockInfluxService.loadPoints).toBeCalledTimes(3);
                expect(mockInfluxService.getPoint().tag).not.toBeCalledWith(
                    'offeringIds',
                    JSON.stringify(['9fdb9e3b-5f24-4f46-aff1-3b98c40e330c']),
                );
                expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
                return res;
            });
            it(`PUT: should enable custom overrides during enrollment`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = undefined;
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                mockInfluxService.getLatestOfferingConfig.mockImplementation(
                    async (): Promise<OfferingInfluxRow[]> => [
                        { ...offeringDBModelGenerator('9fdb9e3b-5f24-4f46-aff1-3b98c40e330c', '1111') },
                    ],
                );
                mockInfluxService.getSingleDimension.mockImplementation(async () => [
                    { ...dimensionDBModelGenerator() },
                ]);
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                const res = await request(server)
                    .put('/customers/12345/enrollment')
                    .send({
                        offeringId: '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c',
                        overrides: {
                            dimensionOverrides: [
                                {
                                    dimensionId: '1111',
                                    consumptionPrice: '1337',
                                },
                            ],
                        },
                    });
                expect(res?.status).toBe(200);
                expect(res.body).toEqual({
                    message: 'Customer updated added',
                    customerId: '12345',
                });
                expect(mockInfluxService.loadPoints).toBeCalledTimes(2);
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'offeringId',
                    '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c',
                );
                expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'dimensionOverrides',
                    JSON.stringify([{ dimensionId: '1111', consumptionPrice: '1337' }]),
                );
                return res;
            });
            it(`PUT: should enable custom overrides during enrollment for tiersGroupByMetadata`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = undefined;
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                mockInfluxService.getLatestOfferingConfig.mockImplementation(
                    async (): Promise<OfferingInfluxRow[]> => [
                        { ...offeringDBModelGenerator('9fdb9e3b-5f24-4f46-aff1-3b98c40e330c', '1111') },
                    ],
                );
                mockInfluxService.getSingleDimension.mockImplementation(async () => [
                    {
                        ...dimensionDBModelGenerator(),
                        tiersGroupByMetadata: JSON.stringify([
                            {
                                metadataGroups: {
                                    foo: 'bar',
                                    baz: 'test',
                                },
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        upperBound: 'inf',
                                        unitPrice: '1',
                                    },
                                ],
                            },
                            {
                                metadataGroups: {
                                    foo: 'aaa',
                                    baz: 'east',
                                },
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        upperBound: '100',
                                        unitPrice: '2',
                                    },
                                ],
                            },
                        ]),
                    },
                ]);
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                const res = await request(server)
                    .put('/customers/12345/enrollment')
                    .send({
                        offeringId: '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c',
                        overrides: {
                            dimensionOverrides: [
                                {
                                    dimensionId: '1111',
                                    tiersGroupByMetadata: [
                                        {
                                            metadataGroups: {
                                                foo: 'bar',
                                                baz: 'test',
                                            },
                                            tiers: [
                                                {
                                                    tierPosition: '1',
                                                    upperBound: 'inf',
                                                    unitPrice: '1337',
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    });
                expect(res?.status).toBe(200);
                expect(res.body).toEqual({
                    message: 'Customer updated added',
                    customerId: '12345',
                });
                expect(mockInfluxService.loadPoints).toBeCalledTimes(2);
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'offeringId',
                    '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c',
                );
                expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'dimensionOverrides',
                    JSON.stringify([
                        {
                            dimensionId: '1111',
                            tiersGroupByMetadata: [
                                {
                                    metadataGroups: { foo: 'bar', baz: 'test' },
                                    tiers: [{ tierPosition: '1', upperBound: 'inf', unitPrice: '1337' }],
                                },
                            ],
                        },
                    ]),
                );
                return res;
            });
            it(`PUT: should not enroll a customer if the dimension overrides change the price from a consumption price to tiers`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = undefined;
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                mockInfluxService.getLatestOfferingConfig.mockImplementation(
                    async (): Promise<OfferingInfluxRow[]> => [
                        { ...offeringDBModelGenerator('9fdb9e3b-5f24-4f46-aff1-3b98c40e330c', '1111') },
                    ],
                );
                const dimensionDbModel = {
                    ...dimensionDBModelGenerator(),
                    priceSegments: '[{}]',
                    tiers: JSON.stringify([
                        {
                            tierPosition: '1',
                            upperBound: 'inf',
                            unitPrice: '1',
                        },
                    ]),
                };
                mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [dimensionDbModel]);
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                const res = await request(server)
                    .put('/customers/12345/enrollment')
                    .send({
                        offeringId: '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c',
                        overrides: {
                            dimensionOverrides: [
                                {
                                    dimensionId: dimensionDbModel?.dimensionId,
                                    consumptionPrice: '1337',
                                },
                            ],
                        },
                    });
                expect(res?.status).toBe(400);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
                return res;
            });
            it(`PUT: should not enroll a customer if the dimension overrides change from tiers to tiersGroupedByMetadata`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.offeringId = undefined;
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockInfluxService.getLatestCustomer.mockImplementation(
                    async (): Promise<CustomerInfluxRow[]> => [customerDbModelData],
                );
                const dimensionId = randomUUID();
                mockInfluxService.getLatestOfferingConfig.mockImplementation(
                    async (): Promise<OfferingInfluxRow[]> => [
                        { ...offeringDBModelGenerator('9fdb9e3b-5f24-4f46-aff1-3b98c40e330c', dimensionId) },
                    ],
                );
                const dimensionDbModel = {
                    ...dimensionDBModelGenerator(dimensionId),
                    priceSegments: '[{}]',
                    tiers: JSON.stringify([
                        {
                            tierPosition: '1',
                            upperBound: 'inf',
                            unitPrice: '1',
                        },
                    ]),
                };
                mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [dimensionDbModel]);
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                const res = await request(server)
                    .put('/customers/12345/enrollment')
                    .send({
                        offeringId: '9fdb9e3b-5f24-4f46-aff1-3b98c40e330c',
                        overrides: {
                            dimensionOverrides: [
                                {
                                    dimensionId,
                                    tiersGroupByMetadata: [
                                        {
                                            metadataGroups: {
                                                foo: 'bar',
                                                baz: 'test',
                                            },
                                            tiers: [
                                                {
                                                    tierPosition: '1',
                                                    upperBound: 'inf',
                                                    unitPrice: '1337',
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    });
                expect(res?.status).toBe(400);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
                return res;
            });
            it(`PUT: should store a new offeringId if removePriorOffering is set to false`, async () => {
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
                    .put('/customers/12345/enrollment')
                    .send({ offeringId: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', removePriorOffering: false })
                    .expect(200)
                    .expect({
                        message: 'Customer updated added',
                        customerId: '12345',
                    });

                expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(2);

                expect(mockInfluxService.getPoint().tag).toBeCalledWith('customerId', '12345');
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'offeringId',
                    '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f',
                );
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'offeringIds',
                    JSON.stringify(['7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', '123456']),
                );
                return res;
            });
            it(`PUT: should not enroll a customer in a new offering if the offeringId is already in the offeringIds array`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.customerId = '12345';
                customerDbModelData.offeringId = '123456';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                mockInfluxService.getLatestCustomer.mockImplementationOnce(
                    async (): Promise<CustomerInfluxRow[]> => [
                        {
                            ...customerDbModelData,
                            offeringIds: JSON.stringify(['7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', '123456']),
                        },
                    ],
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
                await request(server)
                    .put('/customers/12345/enrollment')
                    .send({ offeringId: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', removePriorOffering: false })
                    .expect(400);

                expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
            });
            it(`PUT: should not enroll a customer in a new offering if the offeringId is the only enrolled offering`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.customerId = '12345';
                customerDbModelData.offeringId = '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                mockInfluxService.getLatestCustomer.mockImplementationOnce(
                    async (): Promise<CustomerInfluxRow[]> => [
                        {
                            ...customerDbModelData,
                            offeringIds: JSON.stringify(['7d1c037d-f8f7-46d6-90d2-00a81f8dd82f']),
                        },
                    ],
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
                await request(server)
                    .put('/customers/12345/enrollment')
                    .send({ offeringId: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', removePriorOffering: false })
                    .expect(400);

                expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
            });
            it(`PUT: should remove a single offeringId when unenrollOffering is passed with a valid offeringId`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.customerId = '12345';
                customerDbModelData.offeringId = '123456';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                mockInfluxService.getLatestCustomer.mockImplementationOnce(
                    async (): Promise<CustomerInfluxRow[]> => [
                        {
                            ...customerDbModelData,
                            offeringIds: JSON.stringify(['7d1c037d-f8f7-46d6-90d2-00a81f8dd82f', '123456', '9999']),
                        },
                    ],
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
                await request(server)
                    .put('/customers/12345/enrollment')
                    .send({ unenrollOffering: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f' })
                    .expect(200)
                    .expect({
                        message: 'Customer updated added',
                        customerId: '12345',
                    });

                expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(3);
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'offeringIds',
                    JSON.stringify(['123456', '9999']),
                );
            });
            it(`PUT: should remove a single offeringId when unenrollOffering is passed with a valid offeringId when there are 4 offerings on the customer`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.customerId = '12345';
                customerDbModelData.offeringId = '123456';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                mockInfluxService.getLatestCustomer.mockImplementationOnce(
                    async (): Promise<CustomerInfluxRow[]> => [
                        {
                            ...customerDbModelData,
                            offeringIds: JSON.stringify([
                                '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f',
                                '123456',
                                '9999',
                                '8888',
                            ]),
                        },
                    ],
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
                await request(server)
                    .put('/customers/12345/enrollment')
                    .send({ unenrollOffering: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f' })
                    .expect(200)
                    .expect({
                        message: 'Customer updated added',
                        customerId: '12345',
                    });

                expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(3);
                expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                    'offeringIds',
                    JSON.stringify(['123456', '9999', '8888']),
                );
            });
            it(`PUT: should remove all offeringIds when a customer has set the removePriorOffering to true and the offeringId field is null`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.customerId = '12345';
                customerDbModelData.offeringId = '123456';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                mockInfluxService.getLatestCustomer.mockImplementationOnce(
                    async (): Promise<CustomerInfluxRow[]> => [
                        {
                            ...customerDbModelData,
                            offeringIds: JSON.stringify([
                                '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f',
                                '123456',
                                '9999',
                                '8888',
                            ]),
                        },
                    ],
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
                await request(server).put('/customers/12345/enrollment').send({ offeringId: null }).expect(200).expect({
                    message: 'Customer updated added',
                    customerId: '12345',
                });

                expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(9);
                expect(mockInfluxService.getPoint().tag).not.toBeCalledWith('offeringIds', expect.anything());
            });
            it(`PUT: should remove offeringId when unenrollOffering is passed and there is only one offering on the entity`, async () => {
                const customerDbModelData = customerDBModelGenerator();
                customerDbModelData.customerId = '12345';
                customerDbModelData.offeringId = '123456';
                customerDbModelData.creditBalance = undefined;
                customerDbModelData.businessID = productionBusinessID;
                mockBillingQueue.getDelayed.mockResolvedValue([]);
                mockInfluxService.getLatestCustomer.mockImplementationOnce(
                    async (): Promise<CustomerInfluxRow[]> => [
                        {
                            ...customerDbModelData,
                            offeringIds: JSON.stringify(['7d1c037d-f8f7-46d6-90d2-00a81f8dd82f']),
                        },
                    ],
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
                await request(server)
                    .put('/customers/12345/enrollment')
                    .send({ unenrollOffering: '7d1c037d-f8f7-46d6-90d2-00a81f8dd82f' })
                    .expect(200)
                    .expect({
                        message: 'Customer updated added',
                        customerId: '12345',
                    });

                expect(mockInfluxService.getLatestCustomer).toBeCalledTimes(1);
                expect(mockInfluxService.loadPoints).toBeCalledTimes(3);
                expect(mockInfluxService.getPoint().tag).not.toBeCalledWith(
                    'offeringIds',
                    JSON.stringify(['7d1c037d-f8f7-46d6-90d2-00a81f8dd82f']),
                );
            });
        });
        describe('/children', () => {
            describe(':childId', () => {
                it(`PUT: should add a child to the parent customer`, async () => {
                    const res = await request(server).put('/customers/12345/children/4567').expect(200);
                    expect(res.body).toEqual({
                        message: 'Updated Child Row',
                    });

                    expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
                    expect(mockInfluxService.getPoint().tag).toBeCalledWith('parentId', '12345');
                    expect(mockInfluxService.getPoint().tag).toBeCalledWith('childId', '4567');
                });

                it(`POST: should create a new child for the parent customer`, async () => {
                    const res = await request(server).post('/customers/12345/children/4567').expect(201);
                    expect(res.body).toEqual({
                        message: 'Updated Child Row',
                    });

                    expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
                    expect(mockInfluxService.getPoint().tag).toBeCalledWith('parentId', '12345');
                    expect(mockInfluxService.getPoint().tag).toBeCalledWith('childId', '4567');
                });
                it(`DELETE: should remove a child from the parent customer if the relationship exists`, async () => {
                    mockInfluxService.queryForLedger.mockResolvedValue([
                        { _value: '12345', childId: '4567', parentId: '12345' },
                    ]);
                    const res = await request(server).delete('/customers/12345/children/4567').expect(200);
                    expect(res.body).toEqual({
                        message: 'Removed Child Row',
                    });

                    expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
                    expect(mockInfluxService.getPoint().tag).not.toBeCalledWith('parentId', '12345');
                    expect(mockInfluxService.getPoint().tag).toBeCalledWith('childId', '4567');
                });

                it(`PUT: should not allow circular dependencies to occur`, async () => {
                    mockInfluxService.queryForLedger.mockResolvedValue([
                        { _value: '4567', childId: '12345', parentId: '4567' },
                    ]);
                    const res = await request(server).put('/customers/12345/children/4567').expect(400);
                    expect(res.body).toEqual({
                        message: `circular dependency detected for childId 4567 to parentId 12345`,
                        statusCode: 400,
                        error: 'Bad Request',
                    });

                    expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
                });
                it(`PUT: should put new children in even when there are other children already assigned`, async () => {
                    mockInfluxService.queryForLedger.mockResolvedValue([
                        { _value: '4567', childId: '444', parentId: '4567' },
                        { _value: '4567', childId: '555', parentId: '12345' },
                    ]);
                    const res = await request(server).put('/customers/12345/children/4567').expect(200);
                    expect(res.body).toEqual({
                        message: 'Updated Child Row',
                    });

                    expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
                    expect(mockInfluxService.getPoint().tag).toBeCalledWith('parentId', '12345');
                    expect(mockInfluxService.getPoint().tag).toBeCalledWith('childId', '4567');
                });

                it(`PUT: should not put children in when there is a deeply nested circular dependency`, async () => {
                    mockInfluxService.queryForLedger.mockResolvedValue([
                        { _value: '4567', childId: '12345', parentId: '123' },
                        { _value: '4567', childId: '444', parentId: '4567' },
                        { _value: '12345', childId: '555', parentId: '12345' },
                        { _value: '555', childId: '4567', parentId: '555' },
                    ]);
                    const res = await request(server).put('/customers/444/children/123').expect(400);
                    expect(res.body).toEqual({
                        message: `circular dependency detected for childId 123 to parentId 444`,
                        statusCode: 400,
                        error: 'Bad Request',
                    });

                    expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
                });
            });
        });
    });
});
