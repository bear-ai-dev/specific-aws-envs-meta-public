import request from 'supertest';
import { createMock } from '@golevelup/ts-jest';
import { MockInfluxService } from '../fixtures/module/mockInfluxService';
import { MockJwtStrategy } from '../fixtures/module/mockJwtStrategy';
import { Queue, QueueOptions } from 'bull';
import { OfferingIdExistsRule } from '../../src/offering/dto/offeringIdExists';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { InfluxService } from '../../src/influx/influx.service';
import { AuthGuard } from '@nestjs/passport';
import { getQueueOptionsToken, getQueueToken } from '@nestjs/bull';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { useContainer } from 'class-validator';
import { randomUUID } from 'crypto';
import { customerDBModelGenerator } from '../fixtures/data/customer';
import { offeringDBModelGenerator } from '../fixtures/data/offering';
import { dimensionDBModelGenerator } from '../fixtures/data/dimension';
import { CustomerInfluxRow } from '../../src/influx/entities/customerInfluxRow';
import { aggregateUsageGenerator } from '../fixtures/data/usage';
import { PaymentSchedule, aggregationMethod } from '../../src/dimensions/dto/create-dimension.dto';
import { productionBusinessID } from '../fixtures/data/user';
import { TokenConsumerService } from '../../src/token-consumer/token-consumer.service';
import { TokenRegisterInterceptor } from '../../src/interceptors/tokenRegisterInterceptor';
import { MockTokenRegister } from '../fixtures/module/mockTokenRegister';

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
describe('/usage', () => {
    let app: INestApplication;
    const mockJwtStrategy = new MockJwtStrategy();
    const mockInfluxService = new MockInfluxService();
    const mockBillingQueue = createMock<Queue>();
    const mockOfferingValidator = createMock<OfferingIdExistsRule>();
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
            .useValue(mockBillingQueue)
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

    it('POST: should return 400 if there is no body', async () => {
        await request(server).post('/usage').expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
    });
    it('POST: should return 400 if there is no customerId', async () => {
        await request(server)
            .post('/usage')
            .send({ dimensionId: 'foobar', timestamp: new Date().toISOString(), recordValue: '1', customerId: '' })
            .expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
    });
    it('POST: should return 400 if there is no dimensionId', async () => {
        await request(server)
            .post('/usage')
            .send({ dimensionId: '', timestamp: new Date().toISOString(), recordValue: '1', customerId: 'foobar' })
            .expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
    });
    it('POST: should return 201 if the body is correct', async () => {
        await request(server)
            .post('/usage')
            .send({
                dimensionId: 'foobar',
                timestamp: new Date().toISOString(),
                recordValue: '1',
                customerId: 'foobar',
            })
            .expect(201);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(1);
    });
    it("POST: should load the usage data and create an invoice for it if the boolean query parameter invoice is set to 'true'", async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            { ...customerDbModelData, customerId, offeringId, businessID: productionBusinessID } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = {
            ...dimensionDBModelGenerator(dimensionId),
            paymentSchedule: PaymentSchedule.upfront,
            aggregationMethod: aggregationMethod.last,
        };
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([aggregateUsageGenerator(dimensionId)]);
        mockInfluxService.getCustomerContracts.mockImplementation(async () => []);
        const res = await request(server)
            .post('/usage?invoice=true')
            .send({
                dimensionId,
                timestamp: new Date().toISOString(),
                recordValue: '1000',
                customerId,
            })
            .expect(201);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(2);
        expect(res?.body?.invoiceId).toBeDefined();
        expect(res?.body?.invoiceId).toEqual(expect.any(String));
        const { getPoint } = mockInfluxService;
        const { tag } = getPoint();
        expect(tag).toHaveBeenCalledWith(
            'invoiceLineItems',
            `[{"name":"dimensionName Cool Value - Count - testOffering","quantity":67.846,"unitCost":9.03}]`,
        );
    });
    it("POST: should load the usage data and create an invoice with one line item for each offering enrolled for the customer for it if the boolean query parameter invoice is set to 'true'", async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            {
                ...customerDbModelData,
                customerId,
                offeringId,
                businessID: productionBusinessID,
                offeringIds: JSON.stringify([offeringId, offeringId]),
            } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = {
            ...dimensionDBModelGenerator(dimensionId),
            paymentSchedule: PaymentSchedule.upfront,
            aggregationMethod: aggregationMethod.last,
        };
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        mockInfluxService.getAggregateUsageForDimension.mockResolvedValue([aggregateUsageGenerator(dimensionId)]);
        mockInfluxService.getCustomerContracts.mockImplementation(async () => []);
        const res = await request(server)
            .post('/usage?invoice=true')
            .send({
                dimensionId,
                timestamp: new Date().toISOString(),
                recordValue: '1000',
                customerId,
            })
            .expect(201);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(2);
        expect(res?.body?.invoiceId).toBeDefined();
        expect(res?.body?.invoiceId).toEqual(expect.any(String));
        const { getPoint } = mockInfluxService;
        const { tag } = getPoint();
        expect(tag).toHaveBeenCalledWith(
            'invoiceLineItems',
            `[{"name":"dimensionName Cool Value - Count - testOffering","quantity":67.846,"unitCost":9.03},{"name":"dimensionName Cool Value - Count - testOffering","quantity":67.846,"unitCost":9.03}]`,
        );
    });
    it("POST: should return a 400 and not load usage data if the invoice query parameter is set to 'true' but the payment schedule is not upfront", async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            { ...customerDbModelData, customerId, offeringId, businessID: productionBusinessID } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        const dimensionDBModel = {
            ...dimensionDBModelGenerator(dimensionId),
            paymentSchedule: PaymentSchedule.arrear,
        };
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        mockInfluxService.getCustomerContracts.mockImplementation(async () => []);
        await request(server)
            .post('/usage?invoice=true')
            .send({
                dimensionId,
                timestamp: new Date().toISOString(),
                recordValue: '1',
                customerId,
            })
            .expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should return 400 and not load usage data if there is no offering for the customer on the usage data', async () => {
        const customerId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            { ...customerDbModelData, customerId, businessID: productionBusinessID } as CustomerInfluxRow,
        ]);
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([]);
        mockInfluxService.getSingleDimension.mockImplementation(async () => []);
        mockInfluxService.getCustomerContracts.mockImplementation(async () => []);
        await request(server)
            .post('/usage?invoice=true')
            .send({
                dimensionId,
                timestamp: new Date().toISOString(),
                recordValue: '1',
                customerId,
            })
            .expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
    it('POST: should return 400 and not load usage data if the dimension on the offering doesnt match the usage data dimension', async () => {
        const customerId = randomUUID();
        const offeringId = randomUUID();
        const dimensionId = randomUUID();
        const customerDbModelData = customerDBModelGenerator();
        mockInfluxService.getLatestCustomer.mockResolvedValue([
            { ...customerDbModelData, customerId, offeringId, businessID: productionBusinessID } as CustomerInfluxRow,
        ]);
        const offeringDBModel = offeringDBModelGenerator(offeringId, dimensionId);
        mockInfluxService.getLatestOfferingConfig.mockResolvedValue([offeringDBModel]);
        const dimensionDBModel = {
            ...dimensionDBModelGenerator(dimensionId),
            paymentSchedule: PaymentSchedule.upfront,
        };
        mockInfluxService.getSingleDimension.mockImplementation(async () => [dimensionDBModel]);
        mockInfluxService.getCustomerContracts.mockImplementation(async () => []);
        await request(server)
            .post('/usage?invoice=true')
            .send({
                dimensionId: 'foobar',
                timestamp: new Date().toISOString(),
                recordValue: '1',
                customerId,
            })
            .expect(400);
        expect(mockJwtStrategy.canActivate).toBeCalledTimes(1);
        expect(mockInfluxService.loadPoints).toBeCalledTimes(0);
    });
});
