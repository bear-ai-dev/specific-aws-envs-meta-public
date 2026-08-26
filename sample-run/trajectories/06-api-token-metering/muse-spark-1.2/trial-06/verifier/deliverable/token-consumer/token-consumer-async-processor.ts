import { Inject, Logger, forwardRef } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Cron } from '@nestjs/schedule';
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
import { SupportedMeasurementFrequencies } from '../scheduler/dto/scheduler.dto';

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
    async aggregateAndBill(job: Job<SchedulerEntity & { scheduleParameters?: any }>) {
        TokenConsumerAsyncProcessor.logger.log('Processing Aggregation for meteringco apiCall metering', { data: job.data });
        try {
            const params = (job.data as any).scheduleParameters || job.data;
            const { businessID, subject, startDate, endDate, customerId } = params || {};
            let start: Date;
            let end: Date;
            if (startDate && endDate) {
                start = new Date(startDate);
                end = new Date(endDate);
            } else if (startDate || endDate) {
                // if only one supplied, default the other to 6h window
                if (endDate) {
                    end = new Date(endDate);
                    start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
                } else {
                    start = new Date(startDate);
                    end = new Date(start.getTime() + 6 * 60 * 60 * 1000);
                }
            } else {
                end = new Date();
                start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
            }

            // If a specific customerId is given, bill just that one; otherwise resolve via businessID/ subject or bill all meteringco customers
            if (customerId) {
                // Need businessID for billing – try to infer from meteringco customers lookup
                let saasBusinessID = businessID;
                if (!saasBusinessID) {
                    const all = await InfluxService.getMeteringCoCustomers();
                    const match: any = all.find((c: any) => c.customerId === customerId);
                    if (match) saasBusinessID = match.businessID;
                }
                if (saasBusinessID) {
                    await this.tokenConsumerService.aggregateAndBill({
                        customerId,
                        saasBusinessID,
                        startDate: start,
                        endDate: end,
                    });
                }
                return;
            }

            if (businessID) {
                // Single tenant's platform customer – resolve one
                const envService: any = (this.tokenConsumerService as any).environmentSerivce;
                const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, envService);
                if (res) {
                    await this.tokenConsumerService.aggregateAndBill({
                        customerId: res.meteringcoCustomerId,
                        saasBusinessID: res.saasCustomerAssociatedBusinessID,
                        startDate: start,
                        endDate: end,
                    });
                    return;
                }
                // fallback: if no mapping but businessID is meteringco-production/sandbox itself, treat directly
                if (businessID === 'meteringco-production' || businessID === 'meteringco-sandbox') {
                    // Need to find customerId for that businessID
                    const all: any[] = await InfluxService.getMeteringCoCustomers();
                    const match = all.find((c: any) => c.businessID === businessID);
                    if (match) {
                        await this.tokenConsumerService.aggregateAndBill({
                            customerId: match.customerId,
                            saasBusinessID: match.businessID,
                            startDate: start,
                            endDate: end,
                        });
                        return;
                    }
                }
            }

            // No specific tenant – close period for all platform customers (used by 6h scheduled job)
            const all: any[] = await InfluxService.getMeteringCoCustomers();
            for (const cust of all) {
                await this.tokenConsumerService.aggregateAndBill({
                    customerId: cust.customerId,
                    saasBusinessID: cust.businessID,
                    startDate: start,
                    endDate: end,
                });
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate meteringco tokens', e);
            AuditService.publishEvent({
                message: 'Failed to aggregate meteringco tokens',
                data: [e as any],
                topic: AuditScope.ERROR,
            });
            throw e;
        }
    }

    // Scheduled job runs every six hours – closes the six hours behind it when no window supplied
    @Cron(SupportedMeasurementFrequencies.everySixHours)
    async handleSixHourCron() {
        TokenConsumerAsyncProcessor.logger.log('Running six-hour aggregation cron');
        try {
            // Reuse aggregateAndBill logic with no window (defaults to last 6h)
            const all: any[] = await InfluxService.getMeteringCoCustomers();
            const end = new Date();
            const start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
            for (const cust of all) {
                await this.tokenConsumerService.aggregateAndBill({
                    customerId: cust.customerId,
                    saasBusinessID: cust.businessID,
                    startDate: start,
                    endDate: end,
                });
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Cron aggregation failed', e);
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

    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.aggregationProcessor })
    aggregationFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate meteringco tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
