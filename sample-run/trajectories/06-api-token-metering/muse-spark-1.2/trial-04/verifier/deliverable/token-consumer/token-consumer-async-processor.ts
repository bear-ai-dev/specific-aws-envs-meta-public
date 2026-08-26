import { Inject, Logger, forwardRef, Optional } from '@nestjs/common';
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
        @Optional() @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
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

    // Aggregation processor: runs every six hours, aggregates apiCall tokens and bills
    @Process(TokenConsumerAsyncProcessor.aggregationProcessor)
    async aggregateTokens(job: Job<any>) {
        // job.data may contain: businessID, subject, dimensionType, startDate, endDate, customerId
        // or scheduleParameters wrapper
        const data = job.data?.scheduleParameters || job.data || {};
        const businessID = data.businessID || job.data.businessID;
        const subject = data.subject || job.data.subject;
        const startDate = data.startDate;
        const endDate = data.endDate;
        const customerId = data.customerId;

        TokenConsumerAsyncProcessor.logger.log('Processing Aggregation Token event', {
            businessID,
            subject,
            customerId,
            startDate,
            endDate,
        });
        try {
            // Use TokenConsumerService closePeriod to handle aggregation and billing
            // It will resolve meteringco customer and window
            const result = await this.tokenConsumerService.closePeriod({
                businessID,
                subject,
                customerId,
                startDate: startDate ? new Date(startDate) : undefined,
                endDate: endDate ? new Date(endDate) : undefined,
            } as any);
            TokenConsumerAsyncProcessor.logger.log('Aggregation result', result as any);
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate tokens', e);
            AuditService.publishEvent({
                message: 'Failed to aggregate tokens',
                data: [job.data, (e as any)?.message],
                topic: AuditScope.ERROR,
            });
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

    @OnQueueFailed({ name: TokenConsumerAsyncProcessor.aggregationProcessor })
    aggregateFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
