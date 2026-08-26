import { Point } from '@influxdata/influxdb-client';
import { TokenConsumerService } from './token-consumer.service';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor';
import { TokenType } from './dto/TokenType';
import { TokenConsumer } from './entities/token-consumer.entity';
import { UsageEntity } from '../usage/entities/usage.entity';

const meteringcoCustomer = (businessID: string, customerId: string) => ({
    meteringcoCustomerId: customerId,
    saasCustomerAssociatedBusinessID: businessID,
    meteringcoCustomer: { businessID, customerId } as any,
});

describe('TokenConsumerService metering of meteringco api traffic', () => {
    let loadPoints: jest.Mock;
    let flushPendingWrites: jest.Mock;
    let aggregateMeteringCoToken: jest.Mock;
    let influxService: any;
    let service: TokenConsumerService;

    beforeEach(() => {
        loadPoints = jest.fn(async () => undefined);
        flushPendingWrites = jest.fn(async () => undefined);
        aggregateMeteringCoToken = jest.fn(async () => []);
        influxService = {
            loadPoints,
            flushPendingWrites,
            aggregateMeteringCoToken,
            getPoint: (measurement: string) => new Point(measurement),
        };
        service = new TokenConsumerService(null, null, null, influxService);
        jest.spyOn(TokenConsumerService, 'getMeteringCoCustomerId').mockResolvedValue(
            meteringcoCustomer('meteringco-production', 'cus-prod'),
        );
    });
    afterEach(() => jest.restoreAllMocks());

    it('records a registered call in the token aggregate bucket without flushing inline', async () => {
        await service.registerToken({
            businessID: 'tenant',
            tokenAmount: '0.001',
            timestamp: '2025-05-14T12:04:11.238Z',
            metadata: { tokenType: TokenType.apiCall, uuid: 'call-1' },
        });
        const [bucket, , points, flush] = loadPoints.mock.calls[0];
        expect(bucket).toBe(TokenConsumerAsyncProcessor.tokenAggregateBucket);
        expect(flush).toBe(false);
        const line = (points[0] as Point).toLineProtocol();
        expect(line).toContain(TokenConsumer._measurement);
        expect(line).toContain('customerId=cus-prod');
        expect(line).toContain('businessID=meteringco-production');
        expect(line).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionAccount.dimensionId}`);
        expect(line).toContain('recordValue=0.001');
        // the call is recorded at its own moment, not at the moment it was handed over
        expect(line.endsWith(`${new Date('2025-05-14T12:04:11.238Z').getTime()}000000`)).toBe(true);
    });

    it('records a late call in the period it happened in', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2025-05-14T19:00:00.000Z'));
        await service.registerToken({
            businessID: 'tenant',
            tokenAmount: '0.001',
            timestamp: '2025-05-14T13:00:00.000Z',
            metadata: { tokenType: TokenType.apiCall, uuid: 'late-call' },
        });
        jest.useRealTimers();
        const line = (loadPoints.mock.calls[0][2][0] as Point).toLineProtocol();
        expect(line.endsWith(`${new Date('2025-05-14T13:00:00.000Z').getTime()}000000`)).toBe(true);
    });

    it('gives the same identity to the same call handed over twice', () => {
        const call = { businessID: 'tenant', customerId: 'cus', recordValue: '42', timestamp: '2025-05-14T13:00:00Z' };
        expect(TokenConsumerService.callIdentity(call)).toBe(TokenConsumerService.callIdentity({ ...call }));
        expect(TokenConsumerService.callIdentity(call)).not.toBe(
            TokenConsumerService.callIdentity({ ...call, recordValue: '43' }),
        );
    });

    it('closes the six hours behind now when no window is given', async () => {
        jest.useFakeTimers().setSystemTime(new Date('2025-05-14T18:00:02.118Z'));
        await service.aggregateTokens({ businessID: 'tenant' });
        jest.useRealTimers();
        expect(flushPendingWrites).toHaveBeenCalledWith(TokenConsumerAsyncProcessor.tokenAggregateBucket);
        expect(aggregateMeteringCoToken).toHaveBeenCalledWith({
            customerId: 'cus-prod',
            startDate: new Date('2025-05-14T12:00:00.000Z'),
            endDate: new Date('2025-05-14T18:00:00.000Z'),
        });
    });

    it('totals the window and bills it as a single usage record against meteringco production', async () => {
        aggregateMeteringCoToken.mockResolvedValue([{ _value: 0.20600000000000002 }]);
        await service.aggregateTokens({
            businessID: 'tenant',
            startDate: '2025-05-14T12:00:00.000Z',
            endDate: '2025-05-14T18:00:00.000Z',
        });
        const usageCall = loadPoints.mock.calls.find(([bucket]) => bucket === `${process.env.STAGE}-usage-data`);
        expect(usageCall).toBeDefined();
        const line = (usageCall[2][0] as Point).toLineProtocol();
        expect(line).toContain(UsageEntity._measurement);
        expect(line).toContain('customerId=cus-prod');
        expect(line).toContain('businessID=meteringco-production');
        expect(line).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionAccount.dimensionId}`);
        expect(line).toContain('recordValue=0.206');
        expect(line).toContain('metadata_tokenType="apiCall"');
        expect(line).toContain('metadata_managed="true"');
    });

    it('bills the sandbox account and dimension for a sandbox platform customer', async () => {
        jest.spyOn(TokenConsumerService, 'getMeteringCoCustomerId').mockResolvedValue(
            meteringcoCustomer('meteringco-sandbox', 'cus-sbx'),
        );
        aggregateMeteringCoToken.mockResolvedValue([{ _value: 0.003 }]);
        await service.aggregateTokens({ businessID: 'tenant' });
        const usageCall = loadPoints.mock.calls.find(([bucket]) => bucket === `${process.env.STAGE}-usage-data`);
        const line = (usageCall[2][0] as Point).toLineProtocol();
        expect(line).toContain('businessID=meteringco-sandbox');
        expect(line).toContain(`dimensionId=${TokenConsumerService.meteringcoSandboxAccount.dimensionId}`);
        expect(line).toContain('recordValue=0.003');
    });

    it('does not bill a period which registered no traffic', async () => {
        aggregateMeteringCoToken.mockResolvedValue([]);
        const res = await service.aggregateTokens({ businessID: 'tenant' });
        expect(res?.message).toContain('No tokens registered');
        expect(loadPoints.mock.calls.find(([bucket]) => bucket === `${process.env.STAGE}-usage-data`)).toBeUndefined();
    });

    it('closes the window a scheduled job carries', async () => {
        const processor = new TokenConsumerAsyncProcessor(service, null, null, null);
        const aggregateTokens = jest.spyOn(service, 'aggregateTokens').mockResolvedValue(undefined);
        await processor.aggregateTokens({
            data: {
                businessID: 'tenant',
                subject: 'auth0|1',
                scheduleParameters: {
                    dimensionType: TokenConsumerAsyncProcessor.aggregationProcessor,
                    startDate: '2025-05-14T12:00:00.000Z',
                    endDate: '2025-05-14T18:00:00.000Z',
                },
            },
        } as any);
        expect(aggregateTokens).toHaveBeenCalledWith({
            businessID: 'tenant',
            subject: 'auth0|1',
            startDate: '2025-05-14T12:00:00.000Z',
            endDate: '2025-05-14T18:00:00.000Z',
        });
    });
});
