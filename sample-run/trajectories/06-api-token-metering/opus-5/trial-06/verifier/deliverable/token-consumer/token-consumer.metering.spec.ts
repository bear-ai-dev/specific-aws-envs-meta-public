import { Point } from '@influxdata/influxdb-client';
import { cache as cacheManager } from '../cacheStore';
import { TokenConsumerService, SIX_HOURS_IN_MS } from './token-consumer.service';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor';
import { TokenConsumer } from './entities/token-consumer.entity';
import { UsageEntity } from '../usage/entities/usage.entity';
import { TokenType } from './dto/TokenType';

class FakeInfluxService {
    public written: Array<{ bucket: string; line: string }> = [];
    public aggregatedWindows: Array<{ customerId: string; startDate: Date; endDate: Date }> = [];
    public rows: Array<{ _value: number }> = [];
    getPoint = (measurement: string) => new Point(measurement);
    loadPoints = async (bucket: string, org: string, data: Array<Point>) => {
        data.forEach((point) => this.written.push({ bucket, line: point.toLineProtocol() }));
    };
    flushWriteApi = async () => undefined;
    aggregateMeteringCoToken = async ({ customerId, startDate, endDate }) => {
        this.aggregatedWindows.push({ customerId, startDate, endDate });
        return this.rows;
    };
}

const seedMeteringCoCustomer = async ({ businessID, customerId, account }) =>
    cacheManager.set(
        TokenConsumerService.cacheKey(businessID),
        JSON.stringify({
            customerId,
            saasCustomerAssociatedBusinessID: account,
            customerRes: { customerId, businessID: account },
        }),
    );

describe('metering meteringco api calls', () => {
    let influxService: FakeInfluxService;
    let service: TokenConsumerService;
    const businessID = 'northwind-logistics';
    const meteringcoCustomerId = 'cus-4f1a-northwind-prod';
    beforeEach(async () => {
        influxService = new FakeInfluxService();
        service = new TokenConsumerService(null, null, null, influxService as any);
        await seedMeteringCoCustomer({ businessID, customerId: meteringcoCustomerId, account: 'meteringco-production' });
    });

    it('registers an api call against the meteringco customer in the token aggregate bucket', async () => {
        await service.registerApiCall({
            businessID,
            timestamp: '2025-05-14T12:04:11.238Z',
            identity: 'b41d7c60-2f5e-4a0e-9d61-1c8e0a2f5b31',
        });
        expect(influxService.written.length).toBe(1);
        const [{ bucket, line }] = influxService.written;
        expect(bucket).toBe(TokenConsumerAsyncProcessor.tokenAggregateBucket);
        expect(line).toContain(`${TokenConsumer._measurement},`);
        expect(line).toContain(`customerId=${meteringcoCustomerId}`);
        expect(line).toContain(`businessID=meteringco-production`);
        expect(line).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionApiCallDimensionId}`);
        expect(line).toContain('metadata_tokenType="apiCall"');
        expect(line).toContain('metadata_uuid="b41d7c60-2f5e-4a0e-9d61-1c8e0a2f5b31"');
        // the moment the call happened, in nanoseconds
        expect(line.endsWith(`${new Date('2025-05-14T12:04:11.238Z').getTime()}000000`)).toBe(true);
    });

    it('records the very same call on the very same record when it is delivered more than once', async () => {
        const call = {
            businessID,
            timestamp: '2025-05-14T12:04:11.238Z',
            identity: { customerId: 'tenant-customer', recordValue: 12 },
        };
        await service.registerApiCall(call);
        await service.registerApiCall(call);
        expect(influxService.written.length).toBe(2);
        expect(influxService.written[0].line).toEqual(influxService.written[1].line);
    });

    it('records a call which arrives late at its own moment, never re-dated forward', async () => {
        const happened = '2025-05-14T07:12:04.881Z';
        await service.registerApiCall({ businessID, timestamp: happened, identity: 'late-call' });
        const [{ line }] = influxService.written;
        expect(line.endsWith(`${new Date(happened).getTime()}000000`)).toBe(true);
    });

    it('closes a given window and bills the total against the production account', async () => {
        influxService.rows = [{ _value: 0.20600000000000002 }];
        const res = await service.aggregateTokens({
            businessID,
            startDate: '2025-05-14T12:00:00.000Z',
            endDate: '2025-05-14T18:00:00.000Z',
        });
        expect(res).toEqual({ message: `Token Consumer created for businessID: ${businessID}` });
        expect(influxService.aggregatedWindows).toEqual([
            {
                customerId: meteringcoCustomerId,
                startDate: new Date('2025-05-14T12:00:00.000Z'),
                endDate: new Date('2025-05-14T18:00:00.000Z'),
            },
        ]);
        const billed = influxService.written.filter(({ bucket }) => bucket === `${process.env.STAGE}-usage-data`);
        expect(billed.length).toBe(1);
        expect(billed[0].line).toContain(`${UsageEntity._measurement},`);
        expect(billed[0].line).toContain(`customerId=${meteringcoCustomerId}`);
        expect(billed[0].line).toContain('businessID=meteringco-production');
        expect(billed[0].line).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionApiCallDimensionId}`);
        expect(billed[0].line).toContain(`metadata_tokenType="${TokenType.apiCall}"`);
        expect(billed[0].line).toContain('recordValue=0.206');
    });

    it('bills a sandbox meteringco customer against the sandbox account and dimension', async () => {
        await seedMeteringCoCustomer({
            businessID: 'northwind-staging',
            customerId: 'cus-9c07-northwind-sbx',
            account: 'meteringco-sandbox',
        });
        influxService.rows = [{ _value: 0.003 }];
        await service.aggregateTokens({ businessID: 'northwind-staging' });
        const [{ line }] = influxService.written;
        expect(line).toContain('customerId=cus-9c07-northwind-sbx');
        expect(line).toContain('businessID=meteringco-sandbox');
        expect(line).toContain(`dimensionId=${TokenConsumerService.meteringcoSandboxApiCallDimensionId}`);
        expect(line).toContain('recordValue=0.003');
    });

    it('closes the six hours behind it when no window is given', async () => {
        influxService.rows = [{ _value: 1 }];
        await service.aggregateTokens({ businessID });
        const [{ startDate, endDate }] = influxService.aggregatedWindows;
        expect(endDate.getTime() - startDate.getTime()).toBe(SIX_HOURS_IN_MS);
        expect(endDate.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('does not bill a period without registered api calls', async () => {
        influxService.rows = [];
        await service.aggregateTokens({ businessID });
        expect(influxService.written.length).toBe(0);
    });
});
