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
import { InfluxService } from '../influx/influx.service.js';
import { serializeError } from 'serialize-error';
import { Cron } from '@nestjs/schedule';
import { SupportedMeasurementFrequencies } from '../scheduler/dto/scheduler.dto.js';

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

    @Process(TokenConsumerAsyncProcessor.aggregationProcessor)
    async aggregateMeteringCoTokens(
        job: Job<{ businessID?: string; customerId?: string; startDate?: string; endDate?: string; subject?: string } & SchedulerEntity>,
    ) {
        const data: any = (job as any).data || {};
        // scheduler wraps inside SchedulerEntity.scheduleParameters or directly
        const scheduleParams = data.scheduleParameters || data;
        const customerIdParam = scheduleParams.customerId || data.customerId;
        const businessIDParam = scheduleParams.businessID || data.businessID;
        let startDate: Date;
        let endDate: Date;
        if (scheduleParams.startDate && scheduleParams.endDate) {
            startDate = new Date(scheduleParams.startDate);
            endDate = new Date(scheduleParams.endDate);
        } else if (data.startDate && data.endDate) {
            startDate = new Date(data.startDate);
            endDate = new Date(data.endDate);
        } else {
            // Close the six hours behind it
            endDate = new Date();
            startDate = new Date(endDate.getTime() - 6 * 60 * 60 * 1000);
        }
        TokenConsumerAsyncProcessor.logger.log('Aggregating MeteringCo API calls', { startDate, endDate, customerIdParam, businessIDParam });
        try {
            // Determine list of platform customers to aggregate
            let customers: any[] = [];
            if (customerIdParam) {
                // single customer
                const all = await InfluxService.getMeteringCoCustomers();
                const found = all.find((c) => c.customerId === customerIdParam);
                if (found) customers = [found];
                else {
                    // fallback: treat as single id without lookup
                    customers = [{ customerId: customerIdParam, businessID: businessIDParam || 'meteringco-production', metadata: JSON.stringify({ businessID: businessIDParam || 'unknown' }) }];
                }
            } else {
                customers = await InfluxService.getMeteringCoCustomers();
            }

            const influx = this.influxService || new InfluxService();
            for (const cust of customers) {
                const customerId = cust.customerId;
                const meteringcoBusinessID = cust.businessID; // meteringco-production or meteringco-sandbox
                // Resolve tenant businessID for billing via create (needs tenant)
                let tenantBusinessID: string;
                try {
                    const meta = cust.metadata ? JSON.parse(cust.metadata) : {};
                    tenantBusinessID = meta.businessID || businessIDParam || meteringcoBusinessID;
                } catch {
                    tenantBusinessID = businessIDParam || meteringcoBusinessID;
                }

                // Aggregate via InfluxService
                const res = await influx.aggregateMeteringCoToken({ customerId, startDate, endDate });
                let total = 0;
                if (res && res.length) {
                    // _value is the sum
                    const row: any = res[0];
                    total = typeof row._value === 'number' ? row._value : parseFloat(row._value || '0');
                    if (isNaN(total)) total = 0;
                }
                if (total === 0) {
                    TokenConsumerAsyncProcessor.logger.debug(`No usage for customer ${customerId} in window, skipping`);
                    continue;
                }

                // Check if already billed for this period (to avoid moving invoice on late arrivals)
                // Look for existing usageMeasurement at endDate timestamp
                try {
                    const bucket = `${process.env.STAGE}-usage-data`;
                    const queryApi = (influx as any).dbclient.getQueryApi((influx as any).org);
                    const startCheck = new Date(endDate.getTime() - 1000);
                    const endCheck = new Date(endDate.getTime() + 1000);
                    const checkQuery = `from(bucket: "${bucket}") |> range(start: ${startCheck.toISOString()}, stop: ${endCheck.toISOString()}) |> filter(fn: (r) => r["_measurement"] == "usageMeasurement") |> filter(fn: (r) => r["customerId"] == "${customerId}") |> filter(fn: (r) => r["businessID"] == "${meteringcoBusinessID}")`;
                    const existing = await queryApi.collectRows(checkQuery);
                    if (existing && existing.length) {
                        TokenConsumerAsyncProcessor.logger.debug(`Period already billed for ${customerId} at ${endDate.toISOString()}, skipping`);
                        continue;
                    }
                } catch (e) {
                    // ignore check errors, proceed to bill
                    TokenConsumerAsyncProcessor.logger.warn(`Failed to check existing billing for ${customerId}`, serializeError(e));
                }

                // Bill: total becomes single token for that period
                // Use tenantBusinessID as businessID for token creation so getMeteringCoCustomerId resolves correctly
                await this.tokenConsumerService.create({
                    businessID: tenantBusinessID,
                    tokenAmount: total.toString(),
                    metadata: {
                        tokenType: TokenType.apiCall,
                        managed: 'true',
                    },
                    timestamp: endDate.toISOString(),
                });
                TokenConsumerAsyncProcessor.logger.log(`Billed ${total} for ${customerId} period ${startDate.toISOString()} - ${endDate.toISOString()}`);
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate meteringco tokens', serializeError(e));
            throw e;
        }
    }

    // Also support generic job named aggregateMeteringCoToken via same processor but different handler name for compatibility
    @Process('aggregate-meteringco-token')
    async aggregateMeteringCoTokenLegacy(job: Job<any>) {
        return this.aggregateMeteringCoTokens(job);
    }

    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.processorName })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to load tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
    @Cron(SupportedMeasurementFrequencies.everySixHours)
    async handleSixHourCron() {
        TokenConsumerAsyncProcessor.logger.log('Cron: closing six hour window');
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 6 * 60 * 60 * 1000);
        // Reuse aggregate logic with no explicit customerId to bill all
        const fakeJob = { data: { startDate: startDate.toISOString(), endDate: endDate.toISOString() } } as unknown as Job<any>;
        await this.aggregateMeteringCoTokens(fakeJob);
    }

    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.aggregationProcessor })
    aggregateFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate meteringco tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
