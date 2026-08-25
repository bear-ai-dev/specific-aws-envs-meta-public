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
import { randomUUID } from 'crypto';
import { CreateInvoicesDto } from '../../src/invoice/dto/create-Invoices.dto';
import { customerDBModelGenerator } from '../fixtures/data/customer';
import { CustomerInfluxRow } from '../../src/influx/entities/customerInfluxRow';
import { offeringDBModelGenerator } from '../fixtures/data/offering';
import { dimensionDBModelGenerator } from '../fixtures/data/dimension';
import { aggregateUsageGenerator, groupedMetadataUsageGenerator } from '../fixtures/data/usage';
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

describe('/invoices', () => {
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
    it('POST: should generate an offcycle invoice correctly', async () => {
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
            aggregateUsageGenerator(dimensionId, offeringId),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        const res = await request(server)
            .post('/invoices')
            .send({
                start: '2021-01-01T00:00:00.000Z',
                end: '2021-01-31T00:00:00.000Z',
                customerId,
            } as CreateInvoicesDto);
        expect(res.body).toEqual({ invoiceId: expect.any(String), invoiceIds: [expect.any(String)] });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const mockTag = mockInfluxService.getPoint().tag;
        expect(mockTag).toBeCalledWith('invoiceId', res?.body?.invoiceId);
        expect(mockTag).toBeCalledWith('customerId', customerId);
        expect(mockTag).toBeCalledWith('businessID', customerDbModelData.businessID);
        expect(mockTag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                {
                    name: 'dimensionName Cool Value - Count - testOffering',
                    quantity: 44.499,
                    unitCost: 20,
                },
            ]),
        );
    });
    it('POST: should generate one offcycle invoice per enrolled offering', async () => {
        const customerId = randomUUID();
        const offeringIdarg = randomUUID();
        const offeringId2 = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            {
                ...customerDbModelData,
                customerId,
                offeringId: offeringIdarg,
                offeringIds: JSON.stringify([offeringIdarg, offeringId2]),
            } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringIdarg, dimensionId);
        const secondOfferingDBModel = offeringDBModelGenerator(offeringId2, dimensionId);
        secondOfferingDBModel._value = 'secondOffering';
        const dimensionDBModel = dimensionDBModelGenerator(dimensionId);
        mockInfluxService.getLatestOfferingConfig.mockImplementation(async ({ offeringId }) =>
            offeringId === offeringIdarg ? [offeringDBModel] : [secondOfferingDBModel],
        );
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
            aggregateUsageGenerator(dimensionId, offeringIdarg),
            aggregateUsageGenerator(dimensionId, offeringId2),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        mockInfluxService.getCustomerContracts.mockResolvedValue([
            {
                offeringId: offeringIdarg,
                customerId,
                businessID: customerDbModelData.businessID,
                offeringEnrollmentDate: '2015-01-01T00:00:00.000Z',
            },
            {
                offeringId: offeringId2,
                customerId,
                businessID: customerDbModelData.businessID,
                offeringEnrollmentDate: '2015-01-01T00:00:00.000Z',
            },
        ]);
        const res = await request(server)
            .post('/invoices')
            .send({
                start: '2021-01-01T00:00:00.000Z',
                end: '2021-01-31T00:00:00.000Z',
                customerId,
            } as CreateInvoicesDto);
        expect(res.body).toEqual({
            invoiceId: expect.any(String),
            invoiceIds: [expect.any(String), expect.any(String)],
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(2);
        const mockTag = mockInfluxService.getPoint().tag;
        expect(mockTag).toBeCalledWith('invoiceId', res?.body?.invoiceId);
        expect(mockTag).toBeCalledWith('customerId', customerId);
        expect(mockTag).toBeCalledWith('businessID', customerDbModelData.businessID);
        expect(mockTag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                {
                    name: 'dimensionName Cool Value - Count - testOffering',
                    quantity: 44.499,
                    unitCost: 20,
                },
            ]),
        );
        expect(mockTag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                {
                    name: 'dimensionName Cool Value - Count - secondOffering',
                    quantity: 44.499,
                    unitCost: 20,
                },
            ]),
        );
    });
    it('POST: should generate one offcycle invoice if offeringId is pasted in explictly with a customer that has multiple enrollments', async () => {
        const customerId = randomUUID();
        const offeringIdarg = randomUUID();
        const offeringId2 = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            {
                ...customerDbModelData,
                customerId,
                offeringId: offeringIdarg,
                offeringIds: JSON.stringify([offeringIdarg, offeringId2]),
            } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringIdarg, dimensionId);
        const secondOfferingDBModel = offeringDBModelGenerator(offeringId2, dimensionId);
        secondOfferingDBModel._value = 'secondOffering';
        const dimensionDBModel = dimensionDBModelGenerator(dimensionId);
        mockInfluxService.getLatestOfferingConfig.mockImplementation(async ({ offeringId }) =>
            offeringId === offeringIdarg ? [offeringDBModel] : [secondOfferingDBModel],
        );
        mockInfluxService.getCustomerContracts.mockResolvedValue([
            {
                offeringId: offeringIdarg,
                customerId,
                businessID: customerDbModelData.businessID,
                offeringEnrollmentDate: '2015-01-01T00:00:00.000Z',
            },
            {
                offeringId: offeringId2,
                customerId,
                businessID: customerDbModelData.businessID,
                offeringEnrollmentDate: '2015-01-01T00:00:00.000Z',
            },
        ]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
            aggregateUsageGenerator(dimensionId, offeringIdarg),
            aggregateUsageGenerator(dimensionId, offeringId2),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        const res = await request(server)
            .post('/invoices')
            .send({
                start: '2021-01-01T00:00:00.000Z',
                end: '2021-01-31T00:00:00.000Z',
                customerId,
                offeringId: offeringIdarg,
            } as CreateInvoicesDto);
        expect(res.body).toEqual({
            invoiceId: expect.any(String),
            invoiceIds: [expect.any(String)],
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const mockTag = mockInfluxService.getPoint().tag;
        expect(mockTag).toBeCalledWith('invoiceId', res?.body?.invoiceId);
        expect(mockTag).toBeCalledWith('customerId', customerId);
        expect(mockTag).toBeCalledWith('businessID', customerDbModelData.businessID);
        expect(mockTag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                {
                    name: 'dimensionName Cool Value - Count - testOffering',
                    quantity: 44.499,
                    unitCost: 20,
                },
            ]),
        );
    });
    it('POST: should generate an offcycle invoice correctly with dimension tiers', async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            { ...customerDbModelData, customerId, offeringId } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = {
            ...dimensionDBModelGenerator(dimensionId),
            tiers: JSON.stringify([
                {
                    tierPosition: '1',
                    upperBound: '100',
                    unitPrice: '10',
                    tierName: 'tier1',
                },
                {
                    tierPosition: '2',
                    upperBound: '200',
                    unitPrice: '20',
                    tierName: 'tier2',
                },
                {
                    tierPosition: '3',
                    upperBound: '300',
                    unitPrice: '30',
                    tierName: 'tier3',
                },
                {
                    tierPosition: '4',
                    upperBound: 'inf',
                    unitPrice: '39.99999',
                    tierName: 'tier4',
                },
            ]),
        };
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
            aggregateUsageGenerator(dimensionId, offeringId),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        const res = await request(server)
            .post('/invoices')
            .send({
                start: '2021-01-01T00:00:00.000Z',
                end: '2021-01-31T00:00:00.000Z',
                customerId,
            } as CreateInvoicesDto);
        expect(res.body).toEqual({ invoiceId: expect.any(String), invoiceIds: [expect.any(String)] });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const mockTag = mockInfluxService.getPoint().tag;
        expect(mockTag).toBeCalledWith('invoiceId', res?.body?.invoiceId);
        expect(mockTag).toBeCalledWith('customerId', customerId);
        expect(mockTag).toBeCalledWith('businessID', customerDbModelData.businessID);
        expect(mockTag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                { name: 'dimensionName Cool Value - Count - testOffering - tier1', quantity: 10, unitCost: 10 },
                { name: 'dimensionName Cool Value - Count - testOffering - tier2', quantity: 10, unitCost: 20 },
                { name: 'dimensionName Cool Value - Count - testOffering - tier3', quantity: 10, unitCost: 30 },
                {
                    name: 'dimensionName Cool Value - Count - testOffering - tier4',
                    quantity: 14.499,
                    unitCost: 39.99999,
                },
            ]),
        );
    });
    it('POST: should generate an offcycle invoice correctly with dimension tiers and metadata', async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            { ...customerDbModelData, customerId, offeringId } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = {
            ...dimensionDBModelGenerator(dimensionId),
            tiersGroupByMetadata: JSON.stringify([
                {
                    metadataGroups: {
                        instanceType: 't3.medium',
                        region: 'us-east-1',
                        deployment: 'development',
                    },
                    tiers: [
                        {
                            tierPosition: '1',
                            upperBound: '100',
                            unitPrice: '10',
                            tierName: 'development - tier1',
                        },
                        {
                            tierPosition: '2',
                            upperBound: '200',
                            unitPrice: '20',
                            tierName: 'development - tier2',
                        },
                        {
                            tierPosition: '3',
                            upperBound: '300',
                            unitPrice: '30',
                            tierName: 'development - tier3',
                        },
                        {
                            tierPosition: '4',
                            upperBound: 'inf',
                            unitPrice: '39.99999',
                            tierName: 'development - tier4',
                        },
                    ],
                },
                {
                    metadataGroups: {
                        instanceType: 't3.large',
                        region: 'us-east-2',
                        deployment: 'production',
                    },
                    tiers: [
                        {
                            tierPosition: '1',
                            upperBound: '100',
                            unitPrice: '20',
                            tierName: 'production - tier1',
                        },
                        {
                            tierPosition: '2',
                            upperBound: '200',
                            unitPrice: '40',
                            tierName: 'production - tier2',
                        },
                        {
                            tierPosition: '3',
                            upperBound: '300',
                            unitPrice: '60',
                            tierName: 'production - tier3',
                        },
                        {
                            tierPosition: '4',
                            upperBound: 'inf',
                            unitPrice: '79.99999',
                            tierName: 'production - tier4',
                        },
                    ],
                },
            ]),
        };
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
            groupedMetadataUsageGenerator(
                dimensionId,
                offeringId,
                {
                    instanceType: 't3.medium',
                    region: 'us-east-1',
                    deployment: 'development',
                },
                [
                    {
                        startTime: '2023-08-01T00:00:00Z',
                        endTime: '2023-08-01T23:59:59Z',
                        value: '123.45',
                    },
                    {
                        startTime: '2023-08-02T00:00:00Z',
                        endTime: '2023-08-02T23:59:59Z',
                        value: '321.54',
                    },
                ],
            ),
            groupedMetadataUsageGenerator(
                dimensionId,
                offeringId,
                {
                    instanceType: 't3.large',
                    region: 'us-east-2',
                    deployment: 'production',
                },
                [
                    {
                        startTime: '2023-08-01T00:00:00Z',
                        endTime: '2023-08-01T23:59:59Z',
                        value: '100.00',
                    },
                    {
                        startTime: '2023-08-04T00:00:00Z',
                        endTime: '2023-08-04T23:59:59Z',
                        value: '200.00',
                    },
                ],
            ),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        const res = await request(server)
            .post('/invoices')
            .send({
                start: '2023-08-01T00:00:00Z',
                end: '2023-08-21T00:00:00Z',
                customerId,
            } as CreateInvoicesDto);
        expect(res.body).toEqual({ invoiceId: expect.any(String), invoiceIds: [expect.any(String)] });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const mockTag = mockInfluxService.getPoint().tag;
        expect(mockTag).toBeCalledWith('invoiceId', res?.body?.invoiceId);
        expect(mockTag).toBeCalledWith('customerId', customerId);
        expect(mockTag).toBeCalledWith('businessID', customerDbModelData.businessID);
        expect(mockTag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                {
                    name: 'dimensionName Cool Value - Count - testOffering - development - tier1',
                    quantity: 10,
                    unitCost: 10,
                },
                {
                    name: 'dimensionName Cool Value - Count - testOffering - development - tier2',
                    quantity: 10,
                    unitCost: 20,
                },
                {
                    name: 'dimensionName Cool Value - Count - testOffering - development - tier3',
                    quantity: 10,
                    unitCost: 30,
                },
                {
                    name: 'dimensionName Cool Value - Count - testOffering - development - tier4',
                    quantity: 14.499,
                    unitCost: 39.99999,
                },
                {
                    name: 'dimensionName Cool Value - Count - testOffering - production - tier1',
                    quantity: 10,
                    unitCost: 20,
                },
                {
                    name: 'dimensionName Cool Value - Count - testOffering - production - tier2',
                    quantity: 10,
                    unitCost: 40,
                },
                {
                    name: 'dimensionName Cool Value - Count - testOffering - production - tier3',
                    quantity: 10,
                    unitCost: 60,
                },
            ]),
        );
    });
    it("POST: should create an offcycle invoice using the dimension overrides if they're present on the offering", async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            { ...customerDbModelData, customerId, offeringId } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = {
            ...dimensionDBModelGenerator(dimensionId),
        };
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([
            { ...offeringDBModel, dimensionOverrides: JSON.stringify([{ dimensionId, consumptionPrice: '1338' }]) },
        ]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([
            aggregateUsageGenerator(dimensionId, offeringId),
        ]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        const res = await request(server)
            .post('/invoices')
            .send({
                start: '2021-01-01T00:00:00.000Z',
                end: '2021-01-31T00:00:00.000Z',
                customerId,
            } as CreateInvoicesDto);
        expect(res.body).toEqual({ invoiceId: expect.any(String), invoiceIds: [expect.any(String)] });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const mockTag = mockInfluxService.getPoint().tag;
        expect(mockTag).toBeCalledWith('invoiceId', res?.body?.invoiceId);
        expect(mockTag).toBeCalledWith('customerId', customerId);
        expect(mockTag).toBeCalledWith('businessID', customerDbModelData.businessID);
        expect(mockTag).toBeCalledWith(
            'invoiceLineItems',
            JSON.stringify([
                {
                    name: 'dimensionName Cool Value - Count - testOffering',
                    quantity: 44.499,
                    unitCost: 1338,
                },
            ]),
        );
    });

    describe('/:invoiceId', () => {
        it('GET should return 404 if an invoice is not found', async () => {
            await request(server).get('/invoices/12345').expect(404);
            expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
            expect(mockInfluxService.getSingleInvoice).toBeCalledTimes(1);
        });
    });
});
