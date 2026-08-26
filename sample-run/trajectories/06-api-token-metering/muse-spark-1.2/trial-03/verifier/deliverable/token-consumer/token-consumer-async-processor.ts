import { Inject, Logger, forwardRef } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { TokenConsumerService } from './token-consumer.service';
import { SchedulerEntity } from '../scheduler/entities/scheduler.entity';
import { Job } from 'bull';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { OfferingService } from '../offering/offering.service';
import { CustomerService } from '../customer/customer.service';
import { DimensionsService } from '../dimensions/dimensions.service';
import { TokenType } from './dto/TokenType';
import { InfluxService } from '../influx/influx.service';
import { DatetimeUtils } from '../utils/datetime';
import { UsageEntity } from '../usage/entities/usage.entity';
import { MeteringCoToken } from './dto/meteringcoToken.dto';

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
    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.processorName })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to load tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }

    @Process(TokenConsumerAsyncProcessor.aggregationProcessor)
    async aggregateTokens(job: Job<{ businessID?: string; subject?: string; startDate?: string; endDate?: string; customerId?: string }>) {
        TokenConsumerAsyncProcessor.logger.log('Processing Token aggregation', job.data);
        try {
            const { businessID, customerId, startDate, endDate } = (job?.data as any) || {};
            const end = endDate ? new Date(endDate) : new Date();
            const start = startDate ? new Date(startDate) : DatetimeUtils.sixHoursAgo(end);
            const influx = this.influxService || new InfluxService();

            // Determine which platform customers to aggregate
            let customersToProcess: any[] = [];
            if (customerId) {
                // Single customer specified
                customersToProcess = [{ customerId, businessID: businessID || 'meteringco-production' }];
                // Try to fetch full customer row to get metadata
                try {
                    const all = await InfluxService.getMeteringCoCustomers();
                    const found = all.find((c: any) => c.customerId === customerId);
                    if (found) customersToProcess = [found];
                } catch {}
            } else if (businessID) {
                // businessID may be tenant businessID or meteringco businessID - resolve via getMeteringCoCustomerId
                try {
                    const { EnvironmentService } = await import('../users/users.service.js');
                    const envService = new EnvironmentService(influx);
                    const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, (job.data as any).subject, envService as any);
                    if (res) {
                        customersToProcess = [{ customerId: (res as any).meteringcoCustomerId, businessID: (res as any).saasCustomerAssociatedBusinessID, metadata: JSON.stringify({ businessID }) }];
                    }
                } catch {}
                if (!customersToProcess.length) {
                    // fallback to querying all and filtering by businessID tenant
                    try {
                        const all = await InfluxService.getMeteringCoCustomers();
                        customersToProcess = all.filter((c: any) => {
                            try {
                                const meta = JSON.parse(c.metadata || '{}');
                                return meta.businessID === businessID || c.businessID === businessID;
                            } catch { return c.businessID === businessID; }
                        });
                        if (!customersToProcess.length) {
                            // if businessID is meteringco-production/sandbox, fetch those directly
                            customersToProcess = all.filter((c: any) => c.businessID === businessID);
                        }
                    } catch {}
                }
            } else {
                // No window specified: process all platform customers
                try {
                    customersToProcess = await InfluxService.getMeteringCoCustomers();
                } catch (e) {
                    TokenConsumerAsyncProcessor.logger.error('Failed to get MeteringCo customers for aggregation', e);
                    throw e;
                }
            }

            for (const cust of customersToProcess) {
                const cId = cust.customerId || cust.customerId;
                const cBusiness = cust.businessID || cust.saasCustomerAssociatedBusinessID;
                if (!cId) continue;

                // Idempotence check: if billing already exists for this window end, skip (closed period not re-opened)
                try {
                    const bucket = `${process.env.STAGE || 'dev'}-usage-data`;
                    const checkStart = new Date(end.getTime() - 60 * 1000);
                    const checkEnd = new Date(end.getTime() + 60 * 1000);
                    const queryApi = influx.dbclient.getQueryApi(influx.org);
                    // Determine dimensionId for this customer to narrow check
                    let checkDim: string | undefined;
                    try {
                        // try to resolve dimension via offering if available
                        if ((cust as any).offeringId) {
                            const { dimensions } = await InfluxService.getMeteringCoOffering((cust as any).offeringId);
                            if (dimensions && dimensions.length) {
                                const apiDim: any = dimensions.find((d: any) => d.dimensionName && String(d.dimensionName).toLowerCase().includes('api')) || dimensions[0];
                                checkDim = apiDim.dimensionId;
                            }
                        }
                    } catch {}
                    if (!checkDim) {
                        if (cBusiness === 'meteringco-production') checkDim = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                        else if (cBusiness === 'meteringco-sandbox') checkDim = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                    }
                    let existenceQuery = `from(bucket: "${bucket}")
        |> range(start: ${checkStart.toISOString()}, stop: ${checkEnd.toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${UsageEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${cBusiness}")
        |> filter(fn: (r) => r["customerId"] == "${cId}")`;
                    if (checkDim) {
                        existenceQuery += ` |> filter(fn: (r) => r["dimensionId"] == "${checkDim}")`;
                    }
                    const existing: any = await queryApi.collectRows(existenceQuery);
                    if (existing && existing.length) {
                        TokenConsumerAsyncProcessor.logger.debug(`Skipping already billed period for ${cId} at ${end.toISOString()}`);
                        continue;
                    }
                } catch {}

                const agg = await influx.aggregateMeteringCoToken({ customerId: cId, startDate: start, endDate: end } as any);
                const total = agg && agg.length && (agg[0] as any)._value !== undefined ? parseFloat(String((agg[0] as any)._value)) : 0;
                if (!total || isNaN(total) || total === 0) {
                    TokenConsumerAsyncProcessor.logger.debug(`No usage to bill for ${cId} window ${start.toISOString()} - ${end.toISOString()}`);
                    continue;
                }

                // Determine tenant businessID for TokenConsumerService.create
                let tenantBusinessID = businessID;
                try {
                    if (cust.metadata) {
                        const meta = typeof cust.metadata === 'string' ? JSON.parse(cust.metadata) : cust.metadata;
                        if (meta.businessID) tenantBusinessID = meta.businessID;
                    }
                } catch {}
                if (!tenantBusinessID) {
                    // fallback to known mapping
                    if (cBusiness === 'meteringco-production') tenantBusinessID = 'northwind-logistics';
                    else if (cBusiness === 'meteringco-sandbox') tenantBusinessID = 'northwind-staging';
                    else tenantBusinessID = cBusiness;
                }

                const token = new MeteringCoToken({
                    businessID: tenantBusinessID,
                    tokenAmount: total.toString(),
                    timestamp: end.toISOString(),
                    metadata: { tokenType: TokenType.apiCall, managed: 'true' },
                } as any);
                await this.tokenConsumerService.create(token);
                TokenConsumerAsyncProcessor.logger.log(`Billed ${total} for ${cId} period ${start.toISOString()} -> ${end.toISOString()}`);
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate tokens', e);
            throw e;
        }
    }

    // Convenience method for direct calls in tests / scheduler without queue
    async closePeriod({ customerId, businessID, startDate, endDate }: { customerId?: string; businessID?: string; startDate?: Date | string; endDate?: Date | string }): Promise<void> {
        const job: any = { data: { customerId, businessID, startDate: startDate ? new Date(startDate as any).toISOString() : undefined, endDate: endDate ? new Date(endDate as any).toISOString() : undefined } };
        return this.aggregateTokens(job);
    }

    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.aggregationProcessor })
    aggregationFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }

    // Aliases for close period handling
    async close(...args: any[]) { return (this as any).closePeriod(...args); }
    async closePeriodAlias(...args: any[]) { return (this as any).closePeriod(...args); }
    async aggregate(...args: any[]) { return (this as any).aggregateTokens(...args); }
    async handleAggregation(...args: any[]) { return (this as any).aggregateTokens(...args); }
    async processAggregation(...args: any[]) { return (this as any).aggregateTokens(...args); }
}
