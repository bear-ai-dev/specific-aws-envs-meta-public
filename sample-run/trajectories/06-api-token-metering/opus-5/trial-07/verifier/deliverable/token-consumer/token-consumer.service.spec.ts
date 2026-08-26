process.env.STAGE = process.env.STAGE || 'unit-test';
import { Test, TestingModule } from '@nestjs/testing';
import { TokenConsumerService } from './token-consumer.service';
import { forwardRef } from '@nestjs/common';
import { PrivateAPICustomerModule } from '../customer/customer.module';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module';
import { PrivateAPIOfferingModule } from '../offering/offering.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { AuthzModule } from '../authz/authz.module';
import { InfluxModule } from '../influx/influx.module';
import { UsersModule } from '../users/users.module';
import { Point } from '@influxdata/influxdb-client';
import { cache as cacheManager } from '../cacheStore.js';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor';
import { TokenType } from './dto/TokenType';

describe('TokenConsumerService', () => {
    let service: TokenConsumerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [TokenConsumerService],
            imports: [
                forwardRef(() => PrivateAPICustomerModule),
                forwardRef(() => PrivateAPIDimensionsModule),
                forwardRef(() => PrivateAPIOfferingModule),
                forwardRef(() => SchedulerModule),
                forwardRef(() => AuthzModule),
                forwardRef(() => InfluxModule),
                forwardRef(() => UsersModule),
            ],
        }).compile();

        service = module.get<TokenConsumerService>(TokenConsumerService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});

class FakeInfluxService {
    public loaded: Array<{ bucket: string; org: string; data: Point[]; flush: boolean }> = [];
    public flushed: string[] = [];
    public aggregateResponse: Array<{ _value: number }> = [];
    getPoint = (measurement: string) => new Point(measurement);
    loadPoints = async (bucket: string, org: string, data: Point[], flush = true) => {
        this.loaded.push({ bucket, org, data, flush });
    };
    flushBucket = async (bucket: string) => {
        this.flushed.push(bucket);
    };
    aggregateMeteringCoToken = async () => this.aggregateResponse;
}

describe('TokenConsumerService metering of meteringco api traffic', () => {
    const productionTenant = 'northwind-logistics';
    const sandboxTenant = 'northwind-staging';
    let influxService: FakeInfluxService;
    let service: TokenConsumerService;
    beforeEach(async () => {
        influxService = new FakeInfluxService();
        service = new TokenConsumerService(null, null, null, influxService as any);
        await cacheManager.set(
            TokenConsumerService.cacheKey(productionTenant),
            JSON.stringify({
                customerId: 'cus-4f1a-northwind-prod',
                saasCustomerAssociatedBusinessID: 'meteringco-production',
                customerRes: {},
            }),
        );
        await cacheManager.set(
            TokenConsumerService.cacheKey(sandboxTenant),
            JSON.stringify({
                customerId: 'cus-9c07-northwind-sbx',
                saasCustomerAssociatedBusinessID: 'meteringco-sandbox',
                customerRes: {},
            }),
        );
    });

    it('resolves the platform account, and its dimension, for a platform customer', () => {
        expect(TokenConsumerService.getMeteringCoAccount('meteringco-production')).toEqual({
            businessID: TokenConsumerService.meteringcoProductionBusinessID,
            dimensionId: TokenConsumerService.meteringcoProductionDimensionId,
        });
        expect(TokenConsumerService.getMeteringCoAccount('meteringco-sandbox')).toEqual({
            businessID: TokenConsumerService.meteringcoSandboxBusinessID,
            dimensionId: TokenConsumerService.meteringcoSandboxDimensionId,
        });
    });

    it('registers a call in the token aggregate bucket without a round trip', async () => {
        await service.register({
            businessID: productionTenant,
            tokenAmount: '0.001',
            timestamp: '2025-05-14T12:04:11.238Z',
            metadata: { tokenType: TokenType.apiCall, uuid: 'b41d7c60-2f5e-4a0e-9d61-1c8e0a2f5b31' },
        });
        expect(influxService.loaded.length).toEqual(1);
        const [{ bucket, data, flush }] = influxService.loaded;
        expect(bucket).toEqual(TokenConsumerAsyncProcessor.tokenAggregateBucket);
        // buffered, recording a call may not add a round trip to the request it describes
        expect(flush).toEqual(false);
        const lineProtocol = data[0].toLineProtocol();
        expect(lineProtocol).toContain('tokenConsumer');
        expect(lineProtocol).toContain('customerId=cus-4f1a-northwind-prod');
        expect(lineProtocol).toContain('businessID=meteringco-production');
        expect(lineProtocol).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionDimensionId}`);
        expect(lineProtocol).toContain('metadata_tokenType');
        expect(lineProtocol).toContain('recordValue=0.001');
        // the moment of the call, not the moment it was handed over
        expect(lineProtocol.endsWith(`${new Date('2025-05-14T12:04:11.238Z').getTime()}000000`)).toEqual(true);
    });

    it('registers a late call at its own moment', async () => {
        const lateArrival = '2020-01-01T00:00:00.000Z';
        await service.register({
            businessID: sandboxTenant,
            tokenAmount: '0.001',
            timestamp: lateArrival,
            metadata: { tokenType: TokenType.apiCall, uuid: 'e8d3a97b-405c-4e21-9f6a-7b2c8d0e5194' },
        });
        const lineProtocol = influxService.loaded[0].data[0].toLineProtocol();
        expect(lineProtocol.endsWith(`${new Date(lateArrival).getTime()}000000`)).toEqual(true);
        expect(lineProtocol).toContain(`dimensionId=${TokenConsumerService.meteringcoSandboxDimensionId}`);
        expect(lineProtocol).toContain('businessID=meteringco-sandbox');
    });

    it('bills a token as usage against the platform account of the platform customer', async () => {
        await service.create({
            businessID: productionTenant,
            tokenAmount: '0.206',
            timestamp: '2025-05-14T18:00:00.000Z',
            metadata: { tokenType: TokenType.apiCall, managed: 'true' },
        });
        expect(influxService.loaded.length).toEqual(1);
        const [{ bucket, data, flush }] = influxService.loaded;
        expect(bucket).toEqual(`${process.env.STAGE}-usage-data`);
        expect(flush).toEqual(true);
        const lineProtocol = data[0].toLineProtocol();
        expect(lineProtocol).toContain('usageMeasurement');
        expect(lineProtocol).toContain('customerId=cus-4f1a-northwind-prod');
        expect(lineProtocol).toContain('businessID=meteringco-production');
        expect(lineProtocol).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionDimensionId}`);
        expect(lineProtocol).toContain('recordValue=0.206');
    });

    it('bills the sandbox pair for a sandbox platform customer', async () => {
        await service.create({
            businessID: sandboxTenant,
            tokenAmount: '0.003',
            metadata: { tokenType: TokenType.apiCall, managed: 'true' },
        });
        const lineProtocol = influxService.loaded[0].data[0].toLineProtocol();
        expect(lineProtocol).toContain('businessID=meteringco-sandbox');
        expect(lineProtocol).toContain(`dimensionId=${TokenConsumerService.meteringcoSandboxDimensionId}`);
    });

    it('closes a period, totalling the registered traffic into a single token for the period', async () => {
        influxService.aggregateResponse = [{ _value: 0.20600000000000002 }];
        const res = await service.aggregateTokens({
            businessID: productionTenant,
            startDate: '2025-05-14T12:00:00.000Z',
            endDate: '2025-05-14T18:00:00.000Z',
        });
        expect(res).toEqual({ message: `Token Consumer created for businessID: ${productionTenant}` });
        // pending registrations are committed before the period is totalled
        expect(influxService.flushed).toContain(TokenConsumerAsyncProcessor.tokenAggregateBucket);
        const [{ bucket, data }] = influxService.loaded;
        expect(bucket).toEqual(`${process.env.STAGE}-usage-data`);
        const lineProtocol = data[0].toLineProtocol();
        expect(lineProtocol).toContain('recordValue=0.206');
        expect(lineProtocol).toContain('metadata_managed');
        // the token belongs to the period it closes
        expect(lineProtocol.endsWith(`${new Date('2025-05-14T18:00:00.000Z').getTime()}000000`)).toEqual(true);
    });

    it('does not bill a period without any registered traffic', async () => {
        influxService.aggregateResponse = [];
        const res = await service.aggregateTokens({ businessID: productionTenant });
        expect(res).toEqual({ message: `No tokens to meter for businessID: ${productionTenant}` });
        expect(influxService.loaded.length).toEqual(0);
    });

    it('closes the six hours behind now when no window is given', () => {
        jest.useFakeTimers().setSystemTime(new Date('2025-05-14T18:00:02.118Z'));
        const { startDate, endDate } = TokenConsumerService.resolveAggregationWindow();
        expect(startDate.toISOString()).toEqual('2025-05-14T12:00:02.118Z');
        expect(endDate.toISOString()).toEqual('2025-05-14T18:00:02.118Z');
        jest.useRealTimers();
    });

    it('uses the given window as is', () => {
        const { startDate, endDate } = TokenConsumerService.resolveAggregationWindow({
            startDate: '2025-05-14T06:00:00.000Z',
            endDate: '2025-05-14T12:00:00.000Z',
        });
        expect(startDate.toISOString()).toEqual('2025-05-14T06:00:00.000Z');
        expect(endDate.toISOString()).toEqual('2025-05-14T12:00:00.000Z');
    });

    it('sums a period without floating point noise', () => {
        expect(TokenConsumerService.sumAggregateResponse([{ _value: 0.20600000000000002 }])).toEqual(0.206);
        expect(TokenConsumerService.sumAggregateResponse([{ _value: 0.001 }, { _value: 0.002 }])).toEqual(0.003);
        expect(TokenConsumerService.sumAggregateResponse([])).toEqual(0);
        expect(TokenConsumerService.sumAggregateResponse(undefined)).toEqual(0);
    });
});
