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
import { TokenAsyncAggregatorDto } from './dto/schedulerAsyncProcessor.dto';

@Processor('scheduler_queue')
export class TokenConsumerAsyncProcessor {
    public static processorName = 'token-consumer-async-processor';
    public static aggregationProcessor = 'aggregation-processor';
    public static tokenAggregateBucket = 'dogfood-aggregate-bucket';
    public static schedulerIdGenerator = (businessID: string) =>
        `${TokenConsumerAsyncProcessor.processorName}-${businessID}`;
    public static aggregationSchedulerIdGenerator = (businessID: string) =>
        `${TokenConsumerAsyncProcessor.aggregationProcessor}-${businessID}`;
    private static readonly logger = new Logger(TokenConsumerAsyncProcessor.name);
    constructor(
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => DimensionsService)) readonly dimensionService: DimensionsService,
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

    /**
     * Closes a metering period for a single meteringco customer.
     *
     * Runs every six hours, totalling all of the API traffic registered for the SaaS business
     * inside of the window, and metering that total as a single token for the period.
     * When the job is given no window, the six hours behind now are closed.
     */
    @Process(TokenConsumerAsyncProcessor.aggregationProcessor)
    async aggregateTokens({ data }: Job<SchedulerEntity>) {
        const scheduleParameters = (data?.scheduleParameters ? data.scheduleParameters : {}) as TokenAsyncAggregatorDto;
        const businessID = scheduleParameters?.businessID ? scheduleParameters.businessID : data?.businessID;
        const subject = scheduleParameters?.subject ? scheduleParameters.subject : data?.subject;
        const startDate = scheduleParameters?.startDate
            ? scheduleParameters.startDate
            : (data as unknown as TokenAsyncAggregatorDto)?.startDate;
        const endDate = scheduleParameters?.endDate
            ? scheduleParameters.endDate
            : (data as unknown as TokenAsyncAggregatorDto)?.endDate;
        TokenConsumerAsyncProcessor.logger.log('Processing token aggregation event, logging inputs', {
            businessID,
            subject,
            startDate,
            endDate,
        });
        try {
            return await this.tokenConsumerService.aggregateTokens({
                businessID,
                subject,
                startDate,
                endDate,
            });
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate tokens', e);
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
    aggregationJobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
