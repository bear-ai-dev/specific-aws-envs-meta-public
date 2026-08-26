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
import { OfferingInfluxRow } from '../../src/influx/entities/offeringInfluxTable.entity';
import { offeringDBModelGenerator } from '../fixtures/data/offering';
import { CreateOfferingDTO, ValidBillingCycles } from '../../src/offering/dto/createOffering.dto';
import { dimensionDBModelGenerator } from '../fixtures/data/dimension';
import { OfferingType } from '../../src/offering/entities/OfferingType';
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
describe('/offerings', () => {
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

    it(`GET: Offerings with a fresh account should call auth`, async () => {
        await request(server).get('/offerings').expect(200);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
    });

    it(`GET: Offerings should return an offering if found in the DB`, async () => {
        mockInfluxService.getAllOfferingIds.mockImplementation(async () => [{ offeringId: '12345' }]);
        mockInfluxService.getAllOfferingConfigs.mockImplementationOnce(
            async (): Promise<OfferingInfluxRow[]> => [
                { ...offeringDBModelGenerator('12345', '1111'), billingCycle: ValidBillingCycles.annualToDate },
            ],
        );
        mockInfluxService.getAllDimensions.mockImplementationOnce(async () => [{ ...dimensionDBModelGenerator() }]);
        const res = await request(server).get('/offerings');
        expect(res.body.data[0]).toBeDefined();
        expect(res.body.data[0]).toEqual(
            expect.objectContaining({ offeringId: '12345', billingCycle: ValidBillingCycles.annualToDate }),
        );
    });

    it('POST: Should create an offering if the body passed into the request is correct', async () => {
        await request(server)
            .post('/offerings')
            .send({
                billingCycle: ValidBillingCycles.annualToDate,
                offeringName: 'testOffering',
                offeringType: OfferingType.usageBased,
            } as CreateOfferingDTO)
            .expect(201);
        const mockLoadPoints = mockInfluxService.loadPoints;
        expect(mockLoadPoints).toBeCalledTimes(1);
        const mockTag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(mockTag).toHaveBeenCalledWith('billingCycle', ValidBillingCycles.annualToDate);
        expect(stringField).toHaveBeenCalledWith('offeringName', 'testOffering');
        expect(mockTag).toHaveBeenCalledWith('offeringType', OfferingType.usageBased);
        expect(mockTag).toHaveBeenCalledWith('offeringId', expect.any(String));
    });
    it("POST: should save dimensionOverrides to the DB if they're passed in the request", async () => {
        await request(server)
            .post('/offerings')
            .send({
                billingCycle: ValidBillingCycles.annualToDate,
                offeringName: 'testOffering',
                offeringType: OfferingType.usageBased,
                dimensionOverrides: [{ dimensionId: '1111', consumptionPrice: '1.00' }],
            } as CreateOfferingDTO)
            .expect(201);
        const mockLoadPoints = mockInfluxService.loadPoints;
        expect(mockLoadPoints).toBeCalledTimes(1);
        const mockTag = mockInfluxService.getPoint().tag;
        const stringField = mockInfluxService.getPoint().stringField;
        expect(mockTag).toHaveBeenCalledWith('billingCycle', ValidBillingCycles.annualToDate);
        expect(stringField).toHaveBeenCalledWith('offeringName', 'testOffering');
        expect(mockTag).toHaveBeenCalledWith('offeringType', OfferingType.usageBased);
        expect(mockTag).toHaveBeenCalledWith('offeringId', expect.any(String));
        expect(mockTag).toHaveBeenCalledWith(
            'dimensionOverrides',
            JSON.stringify([{ dimensionId: '1111', consumptionPrice: '1.00' }]),
        );
    });
    describe('/:offeringId', () => {
        it(`GET: Offerings by offeringId should return 404 if not in DB`, async () => {
            await request(server).get('/offerings/12345').expect(404);
            expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        });
        it(`GET: Offering by Id should return an offering if found in the DB`, async () => {
            mockInfluxService.getAllOfferingIds.mockImplementation(async () => [{ offeringId: '12345' }]);
            mockInfluxService.getLatestOfferingConfig.mockImplementationOnce(
                async (): Promise<OfferingInfluxRow[]> => [
                    { ...offeringDBModelGenerator('12345', '1111'), billingCycle: ValidBillingCycles.annualToDate },
                ],
            );
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                { ...dimensionDBModelGenerator() },
            ]);
            const res = await request(server).get('/offerings/12345');
            expect(res.body.data[0]).toBeDefined();
            expect(res.body.data[0]).toEqual(
                expect.objectContaining({ offeringId: '12345', billingCycle: ValidBillingCycles.annualToDate }),
            );
        });
        it(`GET: Offering by Id should return dimensionOverrides if there are any in the DB`, async () => {
            mockInfluxService.getAllOfferingIds.mockImplementation(async () => [{ offeringId: '12345' }]);
            mockInfluxService.getLatestOfferingConfig.mockImplementationOnce(
                async (): Promise<OfferingInfluxRow[]> => [
                    {
                        ...offeringDBModelGenerator('12345', '1111'),
                        billingCycle: ValidBillingCycles.annualToDate,
                        dimensionOverrides: JSON.stringify([{ dimensionId: '1111', consumptionPrice: '1.00' }]),
                    },
                ],
            );
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                { ...dimensionDBModelGenerator() },
            ]);
            const res = await request(server).get('/offerings/12345');
            expect(res.body.data[0]).toBeDefined();
            expect(res.body.data[0]).toEqual(
                expect.objectContaining({
                    offeringId: '12345',
                    billingCycle: ValidBillingCycles.annualToDate,
                    dimensionOverrides: [{ dimensionId: '1111', consumptionPrice: '1.00' }],
                }),
            );
        });

        it(`PUT: Should completely replace the dimensionOverrides stored in the DB`, async () => {
            mockInfluxService.getAllOfferingIds.mockImplementation(async () => [{ offeringId: '12345' }]);
            mockInfluxService.getLatestOfferingConfig.mockImplementationOnce(
                async (): Promise<OfferingInfluxRow[]> => [
                    {
                        ...offeringDBModelGenerator('12345', '1111'),
                        billingCycle: ValidBillingCycles.annualToDate,
                        dimensionOverrides: JSON.stringify([{ dimensionId: '1112', consumptionPrice: '1.00' }]),
                    },
                ],
            );
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                { ...dimensionDBModelGenerator() },
            ]);
            await request(server)
                .put('/offerings/12345')
                .send({
                    dimensionOverrides: [{ dimensionId: '1111', consumptionPrice: '2.00' }],
                })
                .expect(200);
            const mockLoadPoints = mockInfluxService.loadPoints;
            expect(mockLoadPoints).toBeCalledTimes(1);
            const mockTag = mockInfluxService.getPoint().tag;
            expect(mockTag).toHaveBeenCalledWith('billingCycle', ValidBillingCycles.annualToDate);
            expect(mockTag).toHaveBeenCalledWith(
                'dimensionOverrides',
                JSON.stringify([{ dimensionId: '1111', consumptionPrice: '2.00' }]),
            );
        });
        it(`PUT: should remove dimensionOverrides if the request body contains null for dimensionOverrides`, async () => {
            mockInfluxService.getAllOfferingIds.mockImplementation(async () => [{ offeringId: '12345' }]);
            mockInfluxService.getLatestOfferingConfig.mockImplementationOnce(
                async (): Promise<OfferingInfluxRow[]> => [
                    {
                        ...offeringDBModelGenerator('12345', '1111'),
                        billingCycle: ValidBillingCycles.annualToDate,
                        dimensionOverrides: JSON.stringify([{ dimensionId: '1112', consumptionPrice: '1.00' }]),
                    },
                ],
            );
            mockInfluxService.getSingleDimension.mockImplementationOnce(async () => [
                { ...dimensionDBModelGenerator() },
            ]);
            await request(server)
                .put('/offerings/12345')
                .send({
                    dimensionOverrides: null,
                })
                .expect(200);
            const mockLoadPoints = mockInfluxService.loadPoints;
            expect(mockLoadPoints).toBeCalledTimes(1);
            const mockTag = mockInfluxService.getPoint().tag;
            expect(mockTag).toHaveBeenCalledWith('billingCycle', ValidBillingCycles.annualToDate);
            expect(mockTag).not.toHaveBeenCalledWith('dimensionOverrides', expect.any(String));
        });
        it(`DELETE: should properly delete offerings`, async () => {
            mockInfluxService.getAllOfferingIds.mockImplementation(async () => [{ offeringId: '12345' }]);
            mockInfluxService.getLatestOfferingConfig.mockImplementation(
                async (): Promise<OfferingInfluxRow[]> => [
                    {
                        ...offeringDBModelGenerator('12345', '1111'),
                        billingCycle: ValidBillingCycles.annualToDate,
                        dimensionOverrides: JSON.stringify([{ dimensionId: '1112', consumptionPrice: '1.00' }]),
                    },
                ],
            );
            mockInfluxService.getSingleDimension.mockImplementation(async () => [{ ...dimensionDBModelGenerator() }]);
            await request(server).delete('/offerings/12345').expect(200);
            const mockLoadPoints = mockInfluxService.loadPoints;
            expect(mockLoadPoints).toBeCalledTimes(1);
            const mockTag = mockInfluxService.getPoint().tag;
            expect(mockTag).toHaveBeenCalledWith('offeringId', '12345');
            expect(mockTag).toHaveBeenCalledWith('softDelete', 'deleted');
        });
    });
});
