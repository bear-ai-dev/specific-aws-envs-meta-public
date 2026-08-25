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
import {
    CreateDimensionDto,
    PaymentSchedule,
    SampleType,
    aggregationInterval,
    countBasedUnits,
    overageAllowedEnum,
    roundingEnum,
} from '../../src/dimensions/dto/create-dimension.dto.js';
import { dimensionDBModelGenerator } from '../fixtures/data/dimension';
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

describe('/dimensions', () => {
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
    it('POST: should return 400 if no body is sent', async () => {
        const res = await request(server).post('/dimensions').expect(400);
        return res;
    });
    it('POST: should call auth', async () => {
        const res = await request(server).post('/dimensions').send({}).expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        return res;
    });
    it('POST: should load in a simple dimension', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageEntitlement: 100,
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const tag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(stringField).toBeCalledWith('dimensionName', 'testDimension');
        expect(tag).toBeCalledWith('usageEntitlement', '100');
        expect(tag).toBeCalledWith('usageIncrement', '10');
        expect(tag).toBeCalledWith('rounding', 'ceiling');
        expect(tag).toBeCalledWith('dimensionUnit', 'count-based');
        expect(tag).toBeCalledWith('dimensionUnitType', 'count');

        return res;
    });
    it("POST: should load a dimension with a consumption price and overage allowed 'true'", async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                overageAllowed: 'true',
                usageEntitlement: 101,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const tag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(stringField).toBeCalledWith('dimensionName', 'testDimension');
        expect(tag).toBeCalledWith('usageIncrement', '10');
        expect(tag).toBeCalledWith('rounding', 'ceiling');
        expect(tag).toBeCalledWith('overageAllowed', 'true');
        expect(tag).toBeCalledWith('dimensionUnit', 'count-based');
        expect(tag).toBeCalledWith('dimensionUnitType', 'count');
        expect(tag).toBeCalledWith('usageEntitlement', '101');
        expect(tag).toBeCalledWith(
            'priceSegments',
            JSON.stringify([{ lowerLimit: '0', upperLimit: 'inf', price: '1' }]),
        );

        return res;
    });

    it('POST: should load a dimension with just consumption price', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const tag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(stringField).toBeCalledWith('dimensionName', 'testDimension');
        expect(tag).toBeCalledWith('usageIncrement', '10');
        expect(tag).toBeCalledWith('rounding', 'ceiling');
        expect(tag).toBeCalledWith('dimensionUnit', 'count-based');
        expect(tag).toBeCalledWith('dimensionUnitType', 'count');
        expect(tag).toBeCalledWith(
            'priceSegments',
            JSON.stringify([{ lowerLimit: '0', upperLimit: 'inf', price: '1' }]),
        );

        return res;
    });
    it('POST: should load a dimension with paymentSchedule upfront', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                paymentSchedule: PaymentSchedule.upfront,
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const tag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(stringField).toBeCalledWith('dimensionName', 'testDimension');
        expect(tag).toBeCalledWith('usageIncrement', '10');
        expect(tag).toBeCalledWith('rounding', 'ceiling');
        expect(tag).toBeCalledWith('dimensionUnit', 'count-based');
        expect(tag).toBeCalledWith('dimensionUnitType', 'count');
        expect(tag).toBeCalledWith('paymentSchedule', 'upfront');
        expect(tag).toBeCalledWith(
            'priceSegments',
            JSON.stringify([{ lowerLimit: '0', upperLimit: 'inf', price: '1' }]),
        );

        return res;
    });
    it('POST: should load a dimension with paymentSchedule arrear by default', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const tag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(stringField).toBeCalledWith('dimensionName', 'testDimension');
        expect(tag).toBeCalledWith('usageIncrement', '10');
        expect(tag).toBeCalledWith('rounding', 'ceiling');
        expect(tag).toBeCalledWith('dimensionUnit', 'count-based');
        expect(tag).toBeCalledWith('dimensionUnitType', 'count');
        expect(tag).toBeCalledWith('paymentSchedule', 'arrear');
        expect(tag).toBeCalledWith(
            'priceSegments',
            JSON.stringify([{ lowerLimit: '0', upperLimit: 'inf', price: '1' }]),
        );

        return res;
    });
    it('POST: should load sample type when passed in', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                sampleType: SampleType.continious,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const tag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(stringField).toBeCalledWith('dimensionName', 'testDimension');
        expect(tag).toBeCalledWith('usageIncrement', '10');
        expect(tag).toBeCalledWith('rounding', 'ceiling');
        expect(tag).toBeCalledWith('dimensionUnit', 'count-based');
        expect(tag).toBeCalledWith('dimensionUnitType', 'count');
        expect(tag).toBeCalledWith('paymentSchedule', 'arrear');
        expect(tag).toBeCalledWith('sampleType', 'continious');
        expect(tag).toBeCalledWith(
            'priceSegments',
            JSON.stringify([{ lowerLimit: '0', upperLimit: 'inf', price: '1' }]),
        );

        return res;
    });
    it("POST: should set sample type to continous if paymentSchedule is upfront and sampleType isn't set", async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                paymentSchedule: PaymentSchedule.upfront,
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const tag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(stringField).toBeCalledWith('dimensionName', 'testDimension');
        expect(tag).toBeCalledWith('usageIncrement', '10');
        expect(tag).toBeCalledWith('rounding', 'ceiling');
        expect(tag).toBeCalledWith('dimensionUnit', 'count-based');
        expect(tag).toBeCalledWith('dimensionUnitType', 'count');
        expect(tag).toBeCalledWith('paymentSchedule', 'upfront');
        expect(tag).toBeCalledWith('sampleType', 'continious');
        expect(tag).toBeCalledWith(
            'priceSegments',
            JSON.stringify([{ lowerLimit: '0', upperLimit: 'inf', price: '1' }]),
        );

        return res;
    });
    it('POST: should load in a simple dimension with a tier', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        unitPrice: '1',
                        tierPosition: '1',
                        upperBound: '10',
                    },
                ],
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        return res;
    });
    it('POST: should load in a dimension with tiersGroupByMetadata', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiersGroupByMetadata: [
                    {
                        metadataGroups: { foobar: 'barfoo' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                ],
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const { tag } = mockInfluxService.getPoint();
        expect(tag).toBeCalledWith(
            'tiersGroupByMetadata',
            JSON.stringify([
                {
                    metadataGroups: { foobar: 'barfoo' },
                    tiers: [
                        {
                            unitPrice: '1',
                            tierPosition: '1',
                            upperBound: '10',
                        },
                    ],
                },
            ]),
        );
        return res;
    });
    it('POST: should load in a dimension with multiple tiersGroupByMetadata', async () => {
        const tiersGroupByMetadata = [
            {
                metadataGroups: { instanceType: 'downgraded' },
                tiers: [
                    {
                        unitPrice: '1',
                        tierPosition: '1',
                        upperBound: '10',
                    },
                ],
            },
            {
                metadataGroups: { instanceType: 'updated' },
                tiers: [
                    {
                        unitPrice: '100',
                        tierPosition: '1',
                        upperBound: '99000',
                    },
                    {
                        unitPrice: '200',
                        tierPosition: '2',
                        upperBound: '100000',
                    },
                ],
            },
        ];
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '1',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiersGroupByMetadata,
            } as CreateDimensionDto);
        // .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        const { tag } = mockInfluxService.getPoint();
        expect(tag).toBeCalledWith('tiersGroupByMetadata', JSON.stringify(tiersGroupByMetadata));
        return res;
    });
    it('POST: should not load in a dimension with tiersGroupByMetadata where the metadata groups have incosistent keys', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiersGroupByMetadata: [
                    {
                        metadataGroups: { foobar: 'barfoo' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                    {
                        metadataGroups: { instanceType: 'barfoo' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                ],
            } as CreateDimensionDto)
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not load in a dimension with tiersGroupByMetadata where tiers are not consistent with usage increment', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiersGroupByMetadata: [
                    {
                        metadataGroups: { foobar: 'barfoo' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '2',
                                upperBound: '10',
                            },
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '2',
                            },
                        ],
                    },
                ],
            } as CreateDimensionDto)
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not load in a dimension with tiersGroupByMetadata where tiers overlap', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiersGroupByMetadata: [
                    {
                        metadataGroups: { foobar: 'barfoo' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '2',
                                upperBound: '10',
                            },
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '20',
                            },
                        ],
                    },
                    {
                        metadataGroups: { foobar: 'barbar' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '2',
                                upperBound: '20',
                            },
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                ],
            } as CreateDimensionDto)
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not load in a dimension with tiersGroupByMetadata if there is consumption price set', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                consumptionPrice: '1.00',
                tiersGroupByMetadata: [
                    {
                        metadataGroups: { foobar: 'barfoo' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '2',
                                upperBound: '300',
                            },
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                    {
                        metadataGroups: { foobar: 'barbar' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '2',
                                upperBound: '20',
                            },
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                ],
            } as CreateDimensionDto)
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not load in a dimension with tiersGroupByMetadata if there is overageAllowed set', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                overageAllowed: overageAllowedEnum.true,
                tiersGroupByMetadata: [
                    {
                        metadataGroups: { foobar: 'barfoo' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '2',
                                upperBound: '300',
                            },
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                    {
                        metadataGroups: { foobar: 'barbar' },
                        tiers: [
                            {
                                unitPrice: '1',
                                tierPosition: '2',
                                upperBound: '20',
                            },
                            {
                                unitPrice: '1',
                                tierPosition: '1',
                                upperBound: '10',
                            },
                        ],
                    },
                ],
            } as CreateDimensionDto)
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not load in a dimension with tiersGroupByMetadata if there is usageEntitlement set', async () => {
        const basicRequest = {
            dimensionName: 'testDimension',
            usageIncrement: '10',
            rounding: roundingEnum.ceiling,
            consumptionUnit: {
                unit: countBasedUnits['count-based'],
                type: 'count',
            },
            tiersGroupByMetadata: [
                {
                    metadataGroups: { foobar: 'barfoo' },
                    tiers: [
                        {
                            unitPrice: '1',
                            tierPosition: '2',
                            upperBound: '300',
                        },
                        {
                            unitPrice: '1',
                            tierPosition: '1',
                            upperBound: '10',
                        },
                    ],
                },
                {
                    metadataGroups: { foobar: 'barbar' },
                    tiers: [
                        {
                            unitPrice: '1',
                            tierPosition: '2',
                            upperBound: '20',
                        },
                        {
                            unitPrice: '1',
                            tierPosition: '1',
                            upperBound: '10',
                        },
                    ],
                },
            ],
        };
        await request(server)
            .post('/dimensions')
            .send({ ...basicRequest, usageEntitlement: 100 } as CreateDimensionDto)
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
        await request(server)
            .post('/dimensions')
            .send(basicRequest as CreateDimensionDto)
            .expect(201);
    });
    it("POST: should not load in a dimension with tiersGroupByMetadata if the payment schedule is 'upfront'", async () => {
        const basicRequest = {
            dimensionName: 'testDimension',
            usageIncrement: '10',
            rounding: roundingEnum.ceiling,
            consumptionUnit: {
                unit: countBasedUnits['count-based'],
                type: 'count',
            },
            tiersGroupByMetadata: [
                {
                    metadataGroups: { foobar: 'barfoo' },
                    tiers: [
                        {
                            unitPrice: '1',
                            tierPosition: '2',
                            upperBound: '300',
                        },
                        {
                            unitPrice: '1',
                            tierPosition: '1',
                            upperBound: '10',
                        },
                    ],
                },
                {
                    metadataGroups: { foobar: 'barbar' },
                    tiers: [
                        {
                            unitPrice: '1',
                            tierPosition: '2',
                            upperBound: '20',
                        },
                        {
                            unitPrice: '1',
                            tierPosition: '1',
                            upperBound: '10',
                        },
                    ],
                },
            ],
        };
        await request(server)
            .post('/dimensions')
            .send({ ...basicRequest, paymentSchedule: PaymentSchedule.upfront } as CreateDimensionDto)
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
        await request(server)
            .post('/dimensions')
            .send(basicRequest as CreateDimensionDto)
            .expect(201);
    });
    it('POST: should load multiple tiers', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        unitPrice: '1',
                        tierPosition: '1',
                        upperBound: '10',
                    },
                    {
                        unitPrice: '2',
                        tierPosition: '2',
                        upperBound: '20',
                    },
                ],
            } as CreateDimensionDto)
            .expect(201);
        expect(res.body).toMatchObject({
            message: 'created dimension document',
            dimensionId: expect.anything(),
        });
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        return res;
    });
    it('POST: tiers with wrong data types should fail', async () => {
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        unitPrice: 1,
                        upperBound: '10',
                    },
                    {
                        unitPrice: '2',
                        tierPosition: '2',
                        upperBound: '20',
                    },
                ],
            } as CreateDimensionDto)
            .expect(400);

        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
        return res;
    });
    it('POST: tier bounds should be a multiple of the usage increment', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        tierPosition: '1',
                        upperBound: '100',
                    },
                    {
                        tierPosition: '2',
                        upperBound: '201',
                    },
                ],
            } as CreateDimensionDto)
            .expect(400);

        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '11',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        tierPosition: '1',
                        upperBound: '100',
                        unitPrice: '1',
                    },
                    {
                        tierPosition: '2',
                        upperBound: '200',
                        unitPrice: '2',
                    },
                    {
                        tierPosition: '3',
                        upperBound: '300',
                        unitPrice: '3',
                    },
                ],
            })
            .expect(400);

        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it("POST: upperBound can be 'inf' or numberstring", async () => {
        const tiers = [
            {
                tierPosition: '1',
                upperBound: '200',
                unitPrice: '1',
            },
            {
                tierPosition: '2',
                upperBound: '300',
                unitPrice: '3',
            },
            {
                tierPosition: '3',
                upperBound: 'inf',
                unitPrice: '2',
            },
        ];
        const res = await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers,
            })
            .expect(201);

        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
        expect(mockInfluxService.getPoint().tag).toBeCalledWith('tiers', JSON.stringify(tiers));
    });
    it("POST: should not allow overage to be true and entitlement to be 'inf'", async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                overageAllowed: 'true',
                usageEntitlement: 'inf',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            })
            .expect(400);

        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not allow overage to be true and entitlement to be undefined', () => {
        return request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                overageAllowed: 'true',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
            })
            .expect(400);
    });
    it('POST: tiers cannot overlap', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension2',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                overageAllowed: 'true',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        tierPosition: '1',
                        upperBound: '100',
                        unitPrice: '1',
                    },
                    {
                        tierPosition: '2',
                        upperBound: '90',
                        unitPrice: '2',
                    },
                    {
                        tierPosition: '3',
                        upperBound: '300',
                        unitPrice: '3',
                    },
                ],
            })
            .expect(400);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not have multiple tiers with inf', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension2',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                overageAllowed: 'true',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        tierPosition: '1',
                        upperBound: 'inf',
                        unitPrice: '1',
                    },
                    {
                        tierPosition: '2',
                        upperBound: 'inf',
                        unitPrice: '2',
                    },
                    {
                        tierPosition: '3',
                        upperBound: 'inf',
                        unitPrice: '3',
                    },
                ],
            })
            .expect(400);

        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should not allow entitlements, overage and consumption price with tiers', async () => {
        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension2',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                overageAllowed: 'true',
                usageEntitlement: '100',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        tierPosition: '1',
                        upperBound: '100',
                        unitPrice: '1',
                    },
                    {
                        tierPosition: '2',
                        upperBound: '200',
                        unitPrice: '2',
                    },
                    {
                        tierPosition: '3',
                        upperBound: '300',
                        unitPrice: '3',
                    },
                ],
            })
            .expect(400);

        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);

        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension2',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                consumptionPrice: '1',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        tierPosition: '1',
                        upperBound: '100',
                        unitPrice: '1',
                    },
                    {
                        tierPosition: '2',
                        upperBound: '200',
                        unitPrice: '2',
                    },
                    {
                        tierPosition: '3',
                        upperBound: '300',
                        unitPrice: '3',
                    },
                ],
            })
            .expect(400);

        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);

        await request(server)
            .post('/dimensions')
            .send({
                dimensionName: 'testDimension2',
                usageIncrement: '10',
                rounding: roundingEnum.ceiling,
                overageAllowed: 'true',
                usageEntitlement: '100',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                tiers: [
                    {
                        tierPosition: '1',
                        upperBound: '100',
                        unitPrice: '1',
                    },
                    {
                        tierPosition: '2',
                        upperBound: '200',
                        unitPrice: '2',
                    },
                    {
                        tierPosition: '3',
                        upperBound: '300',
                        unitPrice: '3',
                    },
                ],
            })
            .expect(400);
    });
    describe('/:dimensionId', () => {
        it('GET: should return 404 if no dimension is found', async () => {
            await request(server).get('/dimensions/12345').expect(404);
            expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
            expect(mockInfluxService.getSingleDimension).toBeCalledTimes(1);
        });
        it('GET: should return 200 if dimension is found', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                { ...dimensionDBModelGenerator(), overageAllowed: overageAllowedEnum.false },
            ]);
            const res = await request(server).get('/dimensions/12345').expect(200);
            expect(res.body).toEqual({
                data: [
                    {
                        dimensionId: expect.anything(),
                        dimensionName: expect.anything(),
                        usageIncrement: expect.anything(),
                        rounding: roundingEnum.ceiling,
                        consumptionPrice: '20.00',
                        aggregationInterval: aggregationInterval.hour,
                        paymentSchedule: PaymentSchedule.arrear,
                        consumptionUnit: {
                            unit: 'count',
                            type: countBasedUnits['count-based'],
                        },
                        overageAllowed: overageAllowedEnum.false,
                    },
                ],
                message: 'Found Dimension',
            });
        });
        it('GET: should return 200 and tiers if a dimension has tiers', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),
                    priceSegments: '[{}]',
                    tiers: JSON.stringify([
                        {
                            tierPosition: '1',
                            upperBound: 'inf',
                            unitPrice: '1',
                        },
                    ]),
                },
            ]);
            const res = await request(server).get('/dimensions/12345');
            expect(res.body).toEqual({
                data: [
                    {
                        dimensionId: expect.anything(),
                        dimensionName: expect.anything(),
                        usageIncrement: expect.anything(),
                        rounding: roundingEnum.ceiling,
                        aggregationInterval: aggregationInterval.hour,
                        paymentSchedule: PaymentSchedule.arrear,
                        consumptionUnit: {
                            unit: 'count',
                            type: countBasedUnits['count-based'],
                        },
                        tiers: [
                            {
                                tierPosition: '1',
                                upperBound: 'inf',
                                unitPrice: '1',
                            },
                        ],
                    },
                ],
                message: 'Found Dimension',
            });
        });
        it('GET: should return 200 and tiers if a dimension has tiers and the first tier doesnt have a unit price', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),
                    priceSegments: '[{}]',
                    tiers: JSON.stringify([
                        {
                            tierPosition: '1',
                            upperBound: '100',
                        },
                        {
                            tierPosition: '2',
                            upperBound: '200',
                            unitPrice: '2',
                        },
                    ]),
                },
            ]);
            const res = await request(server).get('/dimensions/12345');
            expect(res.body).toEqual({
                data: [
                    {
                        dimensionId: expect.anything(),
                        dimensionName: expect.anything(),
                        usageIncrement: expect.anything(),
                        rounding: roundingEnum.ceiling,
                        aggregationInterval: aggregationInterval.hour,
                        paymentSchedule: PaymentSchedule.arrear,
                        consumptionUnit: {
                            unit: 'count',
                            type: countBasedUnits['count-based'],
                        },
                        tiers: [
                            {
                                tierPosition: '1',
                                upperBound: '100',
                            },
                            {
                                tierPosition: '2',
                                upperBound: '200',
                                unitPrice: '2',
                            },
                        ],
                    },
                ],
                message: 'Found Dimension',
            });
        });
        it("PUT: should update tiers if they're sent", async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),
                    priceSegments: '[{}]',
                    tiers: JSON.stringify([{ tierPosition: '1', upperBound: 'inf', unitPrice: '1' }]),
                },
            ]);
            const tiers = [
                {
                    tierPosition: '1',
                    upperBound: '100',
                    unitPrice: '1',
                },
                {
                    tierPosition: '2',
                    upperBound: '200',
                    unitPrice: '2',
                },
                {
                    tierPosition: '3',
                    upperBound: '300',
                    unitPrice: '3',
                },
            ];
            const res = await request(server)
                .put('/dimensions/12345')
                .send({
                    dimensionName: 'testDimension',
                    usageIncrement: '10',
                    rounding: roundingEnum.ceiling,
                    consumptionUnit: {
                        unit: countBasedUnits['count-based'],
                        type: 'count',
                    },
                    tiers,
                })
                .expect(200);
            expect(res.body).toEqual({
                message: 'loaded dimension update',
                dimensionId: expect.anything(),
            });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('tiers', JSON.stringify(tiers));
        });
        it('PUT: should completely replace tiers with the value set', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),
                    priceSegments: '[{}]',
                    tiers: JSON.stringify([
                        {
                            tierPosition: '1',
                            upperBound: 'inf',
                            unitPrice: '1',
                        },
                    ]),
                },
            ]);
            const tiers = [
                {
                    tierPosition: '1',
                    upperBound: '100',
                    unitPrice: '1',
                },
                {
                    tierPosition: '2',
                    upperBound: '200',
                    unitPrice: '2',
                },
                {
                    tierPosition: '3',
                    upperBound: '300',
                    unitPrice: '3',
                },
            ];
            const res = await request(server)
                .put('/dimensions/12345')
                .send({
                    dimensionName: 'testDimension',
                    usageIncrement: '10',
                    rounding: roundingEnum.ceiling,
                    consumptionUnit: {
                        unit: countBasedUnits['count-based'],
                        type: 'count',
                    },
                    tiers,
                })
                .expect(200);
            expect(res.body).toEqual({
                message: 'loaded dimension update',
                dimensionId: expect.anything(),
            });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('tiers', JSON.stringify(tiers));
        });
        it('PUT: should not allow non tiered dimensions to be converted to tiered and vice versa', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [dimensionDBModelGenerator()]);
            const tiers = [
                {
                    tierPosition: '1',
                    upperBound: '100',
                    unitPrice: '1',
                },
                {
                    tierPosition: '2',
                    upperBound: '200',
                    unitPrice: '2',
                },
                {
                    tierPosition: '3',
                    upperBound: '300',
                    unitPrice: '3',
                },
            ];
            const res = await request(server)
                .put('/dimensions/12345')
                .send({
                    dimensionName: 'testDimension',
                    usageIncrement: '10',
                    rounding: roundingEnum.ceiling,
                    consumptionUnit: {
                        unit: countBasedUnits['count-based'],
                        type: 'count',
                    },
                    tiers,
                })
                .expect(400);
            expect(res.body).toEqual(
                expect.objectContaining({
                    message: 'Cannot change a dimension from tiers to non-tiers or vice versa',
                }),
            );
            expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
        });
        it('PUT: should remove tiers if they are set to null', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),
                    priceSegments: '[{}]',
                    tiers: JSON.stringify([
                        {
                            tierPosition: '1',
                            upperBound: 'inf',
                            unitPrice: '1',
                        },
                    ]),
                },
            ]);
            const res = await request(server)
                .put('/dimensions/12345')
                .send({
                    dimensionName: 'testDimension',
                    usageIncrement: '10',
                    rounding: roundingEnum.ceiling,
                    consumptionPrice: '1',
                    overageAllowed: 'true',
                    usageEntitlement: 100,
                    consumptionUnit: {
                        unit: countBasedUnits['count-based'],
                        type: 'count',
                    },
                    tiers: null,
                })
                .expect(200);
            expect(res.body).toEqual({
                message: 'loaded dimension update',
                dimensionId: expect.anything(),
            });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).not.toBeCalledWith('tiers', expect.anything());
        });
        it('PUT: should not change sample type if nothing is passed in', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),
                    priceSegments: '[{}]',
                    sampleType: SampleType.continious,
                    tiers: JSON.stringify([
                        {
                            tierPosition: '1',
                            upperBound: 'inf',
                            unitPrice: '1',
                        },
                    ]),
                },
            ]);
            const res = await request(server)
                .put('/dimensions/12345')
                .send({
                    dimensionName: 'FakeDimensionName',
                    consumptionUnit: {
                        unit: countBasedUnits['count-based'],
                        type: 'count',
                    },
                })
                .expect(200);
            expect(res.body).toEqual({
                message: 'loaded dimension update',
                dimensionId: expect.anything(),
            });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).toBeCalledWith('sampleType', SampleType.continious);
        });
        it('PUT: should load consumptionPrice changes', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),
                    priceSegments: JSON.stringify([
                        {
                            lowerLimit: '0',
                            upperLimit: 'inf',
                            price: '20.00',
                        },
                    ]),
                    sampleType: SampleType.continious,
                },
            ]);
            const res = await request(server)
                .put('/dimensions/12345')
                .send({
                    dimensionName: 'FakeDimensionName',
                    consumptionPrice: '2',
                })
                .expect(200);
            expect(res.body).toEqual({
                message: 'loaded dimension update',
                dimensionId: expect.anything(),
            });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).toBeCalledWith(
                'priceSegments',
                JSON.stringify([{ lowerLimit: '0', upperLimit: 'inf', price: '2' }]),
            );
        });
        it('PUT: should remove usageEntitlement if null is passed in on the request and there is usageEntitlement in the DB', async () => {
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                {
                    ...dimensionDBModelGenerator(),

                    usageEntitlement: '100',
                },
            ]);
            const res = await request(server)
                .put('/dimensions/12345')
                .send({
                    dimensionName: 'FakeDimensionName',
                    consumptionUnit: {
                        unit: countBasedUnits['count-based'],
                        type: 'count',
                    },
                    usageEntitlement: null,
                })
                .expect(200);
            expect(res.body).toEqual({
                message: 'loaded dimension update',
                dimensionId: expect.anything(),
            });
            expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
            expect(mockInfluxService.getPoint().tag).not.toBeCalledWith('usageEntitlement', expect.anything());
        });
    });
});
