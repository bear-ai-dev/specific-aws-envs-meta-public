import { Inject, Logger, forwardRef } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { TokenConsumerService } from './token-consumer.service.js';
import { SchedulerEntity } from '../scheduler/entities/scheduler.entity.js';
import { Job } from 'bull';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { OfferingService } from '../offering/offering.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { DimensionsService } from '../dimensions/dimensions.service.js';
import { TokenType } from './dto/TokenType.js';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService } from '../users/users.service.js';
import { cache as cacheManager } from '../cacheStore.js';
import { Cron } from '@nestjs/schedule';
import { serializeError } from 'serialize-error';

@Processor('scheduler_queue')
export class TokenConsumerAsyncProcessor {
    public static processorName = 'token-consumer-async-processor';
    public static aggregationProcessor = 'aggregation-processor';
    public static tokenAggregateBucket = 'dogfood-aggregate-bucket';
    public static schedulerIdGenerator = (businessID: string) =>
        `${TokenConsumerAsyncProcessor.processorName}-${businessID}`;
    private static readonly logger = new Logger(TokenConsumerAsyncProcessor.name);
    constructor(
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => DimensionsService)) readonly dimensionService: DimensionsService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentService: EnvironmentService,
    ) {}
    @Process(TokenConsumerAsyncProcessor.processorName)
    async loadTokens({ data: { subject, rate, businessID } }: Job<SchedulerEntity>) {
        TokenConsumerAsyncProcessor.logger.log('Processing Automated Token loading event, logging inputs', {
            rate,
            businessID,
            subject,
        });
        try {
            const { data: offeringData } = await this.offeringService.findAll({ businessID });
            const { data: customerData } = await this.customerService.findAll({ businessID });
            const { data: dimensionData } = await this.dimensionService.findAll({ businessID });

            if (offeringData?.length) {
                await this.tokenConsumerService.create({
                    businessID,
                    tokenAmount: offeringData.length.toString(),
                    metadata: {
                        tokenType: TokenType.offering,
                        managed: 'true',
                    },
                });
            }
            if (customerData?.length) {
                await this.tokenConsumerService.create({
                    businessID,
                    tokenAmount: customerData.length.toString(),
                    metadata: {
                        tokenType: TokenType.customer,
                        managed: 'true',
                    },
                });
            }

            if (dimensionData?.length) {
                await this.tokenConsumerService.create({
                    businessID,
                    tokenAmount: dimensionData.length.toString(),
                    metadata: {
                        tokenType: TokenType.metric,
                        managed: 'true',
                    },
                });
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to load tokens', e);
            throw e;
        }
    }
    @Process(TokenConsumerAsyncProcessor.aggregationProcessor)
    async aggregateTokens(job: Job<any>) {
        const data = (job as any)?.data?.scheduleParameters ?? (job as any)?.data ?? {};
        let { businessID, subject, startDate, endDate, customerId } = data;
        let start: Date;
        let end: Date;
        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
        } else if (startDate || endDate) {
            // if only one provided, treat missing as 6h window
            end = endDate ? new Date(endDate) : new Date();
            start = startDate ? new Date(startDate) : new Date(end.getTime() - 6 * 60 * 60 * 1000);
        } else {
            end = new Date();
            start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
        }
        // Collect customers to bill
        const customersToBill: Array<{ customerId: string; meteringcoBusinessID: string; tenantBusinessID: string }> = [];
        const influx = this.influxService || new InfluxService();
        try {
            if (customerId) {
                // direct customerId provided
                // Need to find its meteringco business and tenant business via getMeteringCoCustomers
                const all = await (InfluxService as any).getMeteringCoCustomers();
                const row: any = all.find((r: any) => r.customerId === customerId);
                if (row) {
                    const tenant = (() => {
                        try { return JSON.parse(row.metadata ?? row.tags?.metadata ?? '{}').businessID; } catch { return undefined; }
                    })();
                    customersToBill.push({ customerId: row.customerId, meteringcoBusinessID: row.businessID, tenantBusinessID: tenant || businessID || row.businessID });
                } else {
                    // fallback if not found in dogfood, try resolve via businessID
                    if (businessID) {
                        const res: any = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentService);
                        if (res) customersToBill.push({ customerId: res.meteringcoCustomerId, meteringcoBusinessID: res.saasCustomerAssociatedBusinessID, tenantBusinessID: businessID });
                    }
                }
            } else if (businessID) {
                const res: any = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentService);
                if (res) customersToBill.push({ customerId: res.meteringcoCustomerId, meteringcoBusinessID: res.saasCustomerAssociatedBusinessID, tenantBusinessID: businessID });
            } else {
                // No specific customer -> bill all meteringco customers
                const all = await (InfluxService as any).getMeteringCoCustomers();
                for (const row of all as any[]) {
                    let tenant: string | undefined;
                    try {
                        const meta = row.metadata ?? (row as any).tags?.metadata;
                        if (meta) tenant = JSON.parse(meta).businessID;
                    } catch {}
                    customersToBill.push({ customerId: row.customerId, meteringcoBusinessID: row.businessID, tenantBusinessID: tenant || row.businessID });
                }
            }
            for (const { customerId: cid, meteringcoBusinessID, tenantBusinessID } of customersToBill) {
                const dimensionId = meteringcoBusinessID === 'meteringco-production' ? '697f07d0-3180-4351-bdff-7ca029e6c18d' : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                const cacheKey = `billed:${cid}:${start.toISOString()}:${end.toISOString()}`;
                const alreadyCached = await cacheManager.get(cacheKey);
                if (alreadyCached) {
                    TokenConsumerAsyncProcessor.logger.log(`Skipping already billed window ${cacheKey} via cache`);
                    continue;
                }
                // Check if already billed by querying usage bucket
                try {
                    const usageQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${start.toISOString()}, stop:${new Date(end.getTime() + 5000).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "usageMeasurement")
        |> filter(fn: (r) => r["customerId"] == "${cid}")
        |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
        |> filter(fn: (r) => r["businessID"] == "${meteringcoBusinessID}")
        |> group()`;
                    const existing: any[] = await influx.queryAPIInstance().collectRows(usageQuery);
                    const isBilled = existing.some((row: any) => {
                        const t = new Date(row._time).getTime();
                        return t >= start.getTime() && t <= end.getTime() + 5000;
                    });
                    if (isBilled) {
                        await cacheManager.set(cacheKey, '1');
                        TokenConsumerAsyncProcessor.logger.log(`Skipping already billed window ${cacheKey} via usage check`);
                        continue;
                    }
                } catch (e) {
                    TokenConsumerAsyncProcessor.logger.error('Failed to check billed status', serializeError(e));
                }
                // Aggregate
                let agg: any[] = [];
                try {
                    agg = await influx.aggregateMeteringCoToken({ customerId: cid, startDate: start, endDate: end });
                } catch (e) {
                    TokenConsumerAsyncProcessor.logger.error('Failed to aggregate', serializeError(e));
                    continue;
                }
                let total = 0;
                if (agg && agg.length) {
                    const val = (agg[0] as any)._value;
                    total = typeof val === 'number' ? val : parseFloat(val);
                    if (isNaN(total)) total = 0;
                }
                if (!total || total === 0) {
                    continue;
                }
                const tokenAmount = total.toString();
                const token = {
                    businessID: tenantBusinessID,
                    tokenAmount,
                    timestamp: end.toISOString(),
                    metadata: { tokenType: TokenType.apiCall, managed: 'true' },
                    subject,
                } as any;
                await cacheManager.set(cacheKey, '1');
                try {
                    await this.tokenConsumerService.create(token);
                    TokenConsumerAsyncProcessor.logger.log(`Billed ${cid} window ${start.toISOString()} - ${end.toISOString()} total ${total}`);
                } catch (e) {
                    await cacheManager.del(cacheKey);
                    throw e;
                }
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate tokens', serializeError(e));
            throw e;
        }
    }

    @Cron('0 */6 * * *')
    async handleCron() {
        TokenConsumerAsyncProcessor.logger.log('Running six-hour cron aggregation');
        // Create a fake job to reuse logic
        const job: any = { data: {} };
        await this.aggregateTokens(job);
    }

    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.processorName })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to load tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.aggregationProcessor })
    aggregationFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
