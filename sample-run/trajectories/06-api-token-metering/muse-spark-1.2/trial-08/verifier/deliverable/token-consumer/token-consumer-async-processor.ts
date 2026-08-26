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
    @Process(TokenConsumerAsyncProcessor.aggregationProcessor)
    async aggregateMeteringCoTokens(job: Job<SchedulerEntity>) {
        const data: any = job.data;
        // scheduleParameters may contain businessID, subject, startDate, endDate, dimensionType
        const scheduleParams = data?.scheduleParameters || data;
        let startDate: Date;
        let endDate: Date;
        if (scheduleParams?.startDate && scheduleParams?.endDate) {
            startDate = new Date(scheduleParams.startDate);
            endDate = new Date(scheduleParams.endDate);
        } else if (data?.startDate && data?.endDate) {
            startDate = new Date(data.startDate);
            endDate = new Date(data.endDate);
        } else {
            // close last six hours
            endDate = new Date();
            startDate = new Date(endDate.getTime() - 6 * 60 * 60 * 1000);
        }
        TokenConsumerAsyncProcessor.logger.log('Aggregating meteringco tokens', { startDate, endDate });
        try {
            // Get all meteringco customers
            const meteringcoCustomers: any[] = await InfluxService.getMeteringCoCustomers() as any;
            if (!meteringcoCustomers || meteringcoCustomers.length === 0) {
                TokenConsumerAsyncProcessor.logger.warn('No meteringco customers found for aggregation');
                return;
            }
            // For each meteringco customer, aggregate tokens in window
            for (const cust of meteringcoCustomers) {
                const customerId = cust.customerId;
                const meteringcoBusinessID = cust.businessID;
                const metadata = cust.metadata ? JSON.parse(cust.metadata) : {};
                const tenantBusinessID = metadata.businessID || meteringcoBusinessID;
                // Aggregate via InfluxService
                const res: any[] = await this.influxService.aggregateMeteringCoToken({ customerId, startDate, endDate });
                let sum = 0;
                if (res && res.length > 0) {
                    const row: any = res[0];
                    // Influx returns _value as sum, or recordValue
                    if (row._value !== undefined && row._value !== null) {
                        sum = parseFloat(row._value);
                    } else if (row.recordValue !== undefined) {
                        sum = parseFloat(row.recordValue);
                    } else if (row['recordValue'] !== undefined) {
                        sum = parseFloat(row['recordValue']);
                    } else {
                        // try first numeric field
                        const vals = Object.values(row).filter(v => typeof v === 'number');
                        if (vals.length >0) sum = vals[0] as number;
                    }
                }
                if (!sum || isNaN(sum) || sum === 0) {
                    TokenConsumerAsyncProcessor.logger.debug(`No tokens to bill for customer ${customerId} in window`);
                    continue;
                }
                // Create token for billing - timestamp is endDate + 2 seconds to mimic original billing (and be within query range)
                const billingTimestamp = new Date(endDate.getTime() + 2000).toISOString();
                const meteringcoToken = new MeteringCoToken({
                    businessID: tenantBusinessID,
                    tokenAmount: sum.toString(),
                    timestamp: billingTimestamp,
                    metadata: {
                        tokenType: TokenType.apiCall,
                        managed: 'true',
                    },
                });
                // This will become billable usage against platform account
                await this.tokenConsumerService.create(meteringcoToken);
                TokenConsumerAsyncProcessor.logger.log(`Billed ${sum} for customer ${customerId} window ${startDate.toISOString()} - ${endDate.toISOString()}`);
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate meteringco tokens', e);
            AuditService.publishEvent({ topic: AuditScope.ERROR, message: 'Failed to aggregate meteringco tokens', data: [e] });
            throw e;
        }
    }
    // Alias for compatibility - some schedulers may use different naming
    @Process('aggregation-processor')
    async aggregationProcessorAlt(job: Job<SchedulerEntity>) {
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
    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.aggregationProcessor })
    aggregationFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate meteringco tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
