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
    async aggregateTokens({ data: { subject, rate, scheduleParameters } }: Job<SchedulerEntity>) {
        const params = scheduleParameters as TokenAsyncAggregatorDto;
        TokenConsumerAsyncProcessor.logger.log('Processing Automated Token loading event, logging inputs', {
            rate,
            subject,
        });
        try {
            const sixHoursAgo = DatetimeUtils.sixHoursAgo(new Date());
            const startDate = params?.startDate ? new Date(params?.startDate) : sixHoursAgo;
            const endDate = params?.endDate ? new Date(params?.endDate) : new Date();
            const res = await TokenConsumerService.getMeteringCoCustomerId(params.businessID);
            if (!res) {
                TokenConsumerAsyncProcessor.logger.error(
                    `Failed to load tokens, no meteringco customer id: ${params.businessID}`,
                );
                AuditService.publishEvent({
                    data: [params],
                    message: 'Failed to load tokens, no meteringco customer id',
                    topic: AuditScope.ERROR,
                });
                return;
            }
            TokenConsumerAsyncProcessor.logger.log(
                `Aggregating tokens for ${
                    params.businessID
                }, with start date: ${startDate.toISOString()} and end date: ${endDate.toISOString()}`,
            );
            const data = await this.influxService.aggregateMeteringCoToken({
                customerId: res?.meteringcoCustomerId,
                startDate,
                endDate,
            });
            if (data && data.length) {
                const { _value } = data[0];
                TokenConsumerAsyncProcessor.logger.log(
                    `Aggregated tokens for ${params.businessID} with value: ${_value}`,
                );
                await this.tokenConsumerService.create({
                    businessID: params.businessID,
                    tokenAmount: _value.toString(),
                    metadata: {
                        tokenType: TokenType.apiCall,
                        managed: 'true',
                    },
                });
            }
            TokenConsumerAsyncProcessor.logger.log(
                `Completed processing for token aggreagation for ${params.businessID}`,
            );
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
}
