import { Point } from '@influxdata/influxdb-client';
import { TokenConsumerService } from './token-consumer.service';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor';
import { TokenType } from './dto/TokenType';
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity';
import { cache as cacheManager } from '../cacheStore.js';

const productionTenant = 'northwind-logistics';
const sandboxTenant = 'northwind-staging';
const productionMeteringCoCustomer = 'cus-4f1a-northwind-prod';
const sandboxMeteringCoCustomer = 'cus-9c07-northwind-sbx';

const primeCustomerCache = async () => {
    await cacheManager.set(
        TokenConsumerService.cacheKey(productionTenant),
        JSON.stringify({
            customerId: productionMeteringCoCustomer,
            saasCustomerAssociatedBusinessID: TokenConsumerService.meteringcoProductionBusinessID,
            customerRes: { customerId: productionMeteringCoCustomer },
        }),
    );
    await cacheManager.set(
        TokenConsumerService.cacheKey(sandboxTenant),
        JSON.stringify({
            customerId: sandboxMeteringCoCustomer,
            saasCustomerAssociatedBusinessID: TokenConsumerService.meteringcoSandboxBusinessID,
            customerRes: { customerId: sandboxMeteringCoCustomer },
        }),
    );
};

type Written = { bucket: string; flush: boolean; lines: string[] };

const mockInflux = () => {
    const written: Written[] = [];
    return {
        written,
        aggregateMeteringCoTokenInput: [] as any[],
        aggregateRows: [] as any[],
        getPoint: (measurement: string) => new Point(measurement),
        loadPoints: jest.fn(async function (this: any, bucket: string, org: string, data: Point[], flush = true) {
            written.push({ bucket, flush, lines: data.map((point) => point.toLineProtocol()) });
        }),
        flushPoints: jest.fn(async () => undefined),
        bufferPoints: jest.fn(),
        aggregateMeteringCoToken: jest.fn(async function (this: any, input: any) {
            (this as any).aggregateMeteringCoTokenInput.push(input);
            return (this as any).aggregateRows;
        }),
    };
};

const linesFor = (influx: ReturnType<typeof mockInflux>, bucket: string) =>
    influx.written.filter((entry) => entry.bucket === bucket).flatMap((entry) => entry.lines);

describe('meteringco api call metering', () => {
    let influx: any;
    let service: TokenConsumerService;
    beforeEach(async () => {
        await cacheManager.reset();
        await primeCustomerCache();
        influx = mockInflux();
        service = new TokenConsumerService(
            { create: jest.fn(), remove: jest.fn() } as any,
            { signIn: jest.fn() } as any,
            { InfluxService: influx } as any,
        );
    });

    describe('registering a call', () => {
        it('records the call against the meteringco customer in the token aggregate bucket', async () => {
            await TokenConsumerService.registerToken(
                {
                    businessID: productionTenant,
                    tokenAmount: TokenConsumerService.apiCallTokenAmount,
                    timestamp: '2025-05-14T12:04:11.238Z',
                    metadata: { tokenType: TokenType.apiCall, uuid: 'b41d7c60' },
                },
                undefined,
                influx,
            );
            expect(influx.written).toHaveLength(1);
            const [{ bucket, flush, lines }] = influx.written;
            expect(bucket).toBe(TokenConsumerAsyncProcessor.tokenAggregateBucket);
            // no round trip is added to the request being metered
            expect(flush).toBe(false);
            expect(lines[0]).toContain('tokenConsumer,');
            expect(lines[0]).toContain(`businessID=${TokenConsumerService.meteringcoProductionBusinessID}`);
            expect(lines[0]).toContain(`customerId=${productionMeteringCoCustomer}`);
            expect(lines[0]).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionApiCallDimensionId}`);
            expect(lines[0]).toContain('metadata_tokenType="apiCall"');
            expect(lines[0]).toContain('recordValue=0.001');
            // the moment of the call, in nanoseconds, is part of the record
            expect(lines[0].endsWith(`${new Date('2025-05-14T12:04:11.238Z').getTime()}000000`)).toBe(true);
        });

        it('meters the sandbox pair when the meteringco customer lives in sandbox', async () => {
            await TokenConsumerService.registerToken(
                { businessID: sandboxTenant, timestamp: '2025-05-14T13:22:47.583Z' },
                undefined,
                influx,
            );
            const [line] = linesFor(influx, TokenConsumerAsyncProcessor.tokenAggregateBucket);
            expect(line).toContain(`businessID=${TokenConsumerService.meteringcoSandboxBusinessID}`);
            expect(line).toContain(`customerId=${sandboxMeteringCoCustomer}`);
            expect(line).toContain(`dimensionId=${TokenConsumerService.meteringcoSandboxApiCallDimensionId}`);
        });

        it('is idempotent, the same call handed over twice is the very same record', async () => {
            const call = {
                businessID: productionTenant,
                timestamp: '2025-05-14T12:04:11.238Z',
                metadata: { tokenType: TokenType.apiCall, uuid: 'b41d7c60' },
            };
            await TokenConsumerService.registerToken(call, undefined, influx);
            // handed over again a period later
            await TokenConsumerService.registerToken(call, undefined, influx);
            const lines = linesFor(influx, TokenConsumerAsyncProcessor.tokenAggregateBucket);
            expect(lines).toHaveLength(2);
            expect(lines[0]).toBe(lines[1]);
        });

        it('records a late call at its own moment, never at the moment it arrived', async () => {
            const happenedAt = '2025-05-14T07:12:04.881Z';
            await TokenConsumerService.registerToken(
                { businessID: productionTenant, timestamp: happenedAt, metadata: { tokenType: TokenType.apiCall } },
                undefined,
                influx,
            );
            const [line] = linesFor(influx, TokenConsumerAsyncProcessor.tokenAggregateBucket);
            expect(line.endsWith(`${new Date(happenedAt).getTime()}000000`)).toBe(true);
        });
    });

    describe('closing a period', () => {
        it('totals the window and bills it as a single token of usage', async () => {
            const publish = jest.spyOn(StandardMeasurementEntity, 'publish');
            influx.aggregateRows = [{ _value: 0.20600000000000002, _field: 'recordValue' }];
            const res = await service.aggregateTokens({
                businessID: productionTenant,
                startDate: '2025-05-14T12:00:00.000Z',
                endDate: '2025-05-14T18:00:00.000Z',
            });
            expect(res).toBeDefined();
            expect(influx.aggregateMeteringCoToken).toHaveBeenCalledWith({
                customerId: productionMeteringCoCustomer,
                startDate: new Date('2025-05-14T12:00:00.000Z'),
                endDate: new Date('2025-05-14T18:00:00.000Z'),
            });
            const [usageLine] = linesFor(influx, `${process.env.STAGE}-usage-data`);
            expect(usageLine).toContain('usageMeasurement,');
            expect(usageLine).toContain(`businessID=${TokenConsumerService.meteringcoProductionBusinessID}`);
            expect(usageLine).toContain(`customerId=${productionMeteringCoCustomer}`);
            expect(usageLine).toContain(`dimensionId=${TokenConsumerService.meteringcoProductionApiCallDimensionId}`);
            expect(usageLine).toContain('metadata_tokenType="apiCall"');
            expect(usageLine).toContain('recordValue=0.206');
            expect(publish).toHaveBeenCalled();
            publish.mockRestore();
        });

        it('bills nothing when no call was registered in the period', async () => {
            influx.aggregateRows = [];
            await service.aggregateTokens({
                businessID: productionTenant,
                startDate: '2025-06-20T06:00:00.000Z',
                endDate: '2025-06-20T12:00:00.000Z',
            });
            expect(linesFor(influx, `${process.env.STAGE}-usage-data`)).toHaveLength(0);
        });

        it('closes the six hours behind it when no window is given', async () => {
            influx.aggregateRows = [{ _value: 0.002 }];
            jest.useFakeTimers({ doNotFake: ['setTimeout', 'setInterval', 'nextTick', 'setImmediate'] });
            jest.setSystemTime(new Date('2025-05-14T12:00:01.507Z'));
            try {
                await service.aggregateTokens({ businessID: productionTenant });
            } finally {
                jest.useRealTimers();
            }
            expect(influx.aggregateMeteringCoToken).toHaveBeenCalledWith({
                customerId: productionMeteringCoCustomer,
                startDate: new Date('2025-05-14T06:00:00.000Z'),
                endDate: new Date('2025-05-14T12:00:00.000Z'),
            });
        });

        it('ships anything still buffered before reading the window', async () => {
            influx.aggregateRows = [];
            await service.aggregateTokens({ businessID: productionTenant });
            expect(influx.flushPoints).toHaveBeenCalledWith(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
            );
        });
    });

    describe('the period a call belongs to', () => {
        it('is the six hour window its own moment falls in', () => {
            const first = TokenConsumerService.getAggregationWindow({ now: new Date('2025-05-14T18:00:02.118Z') });
            expect(first.startDate.toISOString()).toBe('2025-05-14T12:00:00.000Z');
            expect(first.endDate.toISOString()).toBe('2025-05-14T18:00:00.000Z');
            const second = TokenConsumerService.getAggregationWindow({ now: new Date('2025-05-14T12:00:01.507Z') });
            expect(second.startDate.toISOString()).toBe('2025-05-14T06:00:00.000Z');
            expect(second.endDate.toISOString()).toBe('2025-05-14T12:00:00.000Z');
        });
    });

    describe('the aggregation processor', () => {
        it('closes the period of the business the job was scheduled for', async () => {
            const tokenConsumerService = { aggregateTokens: jest.fn() } as any;
            const processor = new TokenConsumerAsyncProcessor(tokenConsumerService, {} as any, {} as any, {} as any);
            await processor.aggregateTokens({
                data: {
                    businessID: productionTenant,
                    subject: 'auth0|1',
                    scheduleParameters: {
                        businessID: productionTenant,
                        subject: 'auth0|1',
                        dimensionType: TokenConsumerAsyncProcessor.aggregationProcessor,
                        startDate: '2025-05-14T12:00:00.000Z',
                        endDate: '2025-05-14T18:00:00.000Z',
                    },
                } as any,
            } as any);
            expect(tokenConsumerService.aggregateTokens).toHaveBeenCalledWith({
                businessID: productionTenant,
                subject: 'auth0|1',
                startDate: '2025-05-14T12:00:00.000Z',
                endDate: '2025-05-14T18:00:00.000Z',
            });
        });
    });
});
