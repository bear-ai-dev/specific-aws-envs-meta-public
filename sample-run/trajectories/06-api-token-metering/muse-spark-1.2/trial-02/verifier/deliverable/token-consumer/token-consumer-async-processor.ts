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
import { EnvironmentService } from '../users/users.service';
import { TokenConsumer } from './entities/token-consumer.entity';

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
    async aggregateTokens(job: Job<SchedulerEntity>) {
        TokenConsumerAsyncProcessor.logger.log('Processing Aggregation event', job.data);
        try {
            const scheduleParameters: any = (job.data as any).scheduleParameters || (job.data as any);
            const businessID: string | undefined = scheduleParameters.businessID || (job.data as any).businessID;
            const subject: string | undefined = scheduleParameters.subject || (job.data as any).subject;
            let startDate: Date | undefined;
            let endDate: Date | undefined;
            if (scheduleParameters.startDate && scheduleParameters.endDate) {
                startDate = new Date(scheduleParameters.startDate);
                endDate = new Date(scheduleParameters.endDate);
            } else if ((job.data as any).startDate && (job.data as any).endDate) {
                startDate = new Date((job.data as any).startDate);
                endDate = new Date((job.data as any).endDate);
            }

            if (!startDate || !endDate || isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                const now = new Date();
                const sixHoursMs = 6 * 60 * 60 * 1000;
                endDate = new Date(now);
                endDate.setUTCMinutes(0, 0, 0);
                endDate.setUTCSeconds(0, 0);
                const hrs = endDate.getUTCHours();
                const floored = Math.floor(hrs / 6) * 6;
                endDate.setUTCHours(floored, 0, 0, 0);
                startDate = new Date(endDate.getTime() - sixHoursMs);
            }

            TokenConsumerAsyncProcessor.logger.log(`Aggregating window ${startDate.toISOString()} - ${endDate.toISOString()}`);

            // Determine customers to process
            // If businessID provided, process that one tenant's platform customer
            // Otherwise process all platform customers
            let meteringcoCustomerInfos: Array<{ tenantBusinessID: string; meteringcoCustomerId: string; saasCustomerAssociatedBusinessID: string; meteringcoCustomer: any }> = [];

            if (businessID) {
                const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentService);
                if (res) {
                    meteringcoCustomerInfos.push({ tenantBusinessID: businessID, ...res });
                } else {
                    TokenConsumerAsyncProcessor.logger.warn(`No meteringco customer for businessID ${businessID}`);
                    return;
                }
            } else {
                // No specific businessID -> aggregate all platform customers (prod and sandbox)
                const allMeteringCoCustomers: any[] = await (InfluxService as any).getMeteringCoCustomers();
                for (const row of allMeteringCoCustomers) {
                    try {
                        const metadata = row.metadata ? JSON.parse(row.metadata) : {};
                        const tenantBusinessID = metadata.businessID;
                        if (!tenantBusinessID) continue;
                        const res = await TokenConsumerService.getMeteringCoCustomerId(tenantBusinessID, subject, this.environmentService);
                        if (res) meteringcoCustomerInfos.push({ tenantBusinessID, ...res });
                    } catch (_) {}
                }
                // Fallback if still empty: try known tenants
                if (meteringcoCustomerInfos.length === 0) {
                    for (const tenant of ['northwind-logistics', 'northwind-staging']) {
                        try {
                            const res = await TokenConsumerService.getMeteringCoCustomerId(tenant, subject, this.environmentService);
                            if (res) meteringcoCustomerInfos.push({ tenantBusinessID: tenant, ...res });
                        } catch (_) {}
                    }
                }
            }

            for (const info of meteringcoCustomerInfos) {
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = info;
                // Resolve dimensionId
                let dimensionId: string | undefined;
                const offering: any = (meteringcoCustomer as any)?.offering;
                if (offering?.dimensions && Array.isArray(offering.dimensions)) {
                    const apiCallDim = offering.dimensions.find((d: any) => d.dimensionId === '697f07d0-3180-4351-bdff-7ca029e6c18d' || d.dimensionId === '00abdf4f-f975-41c6-8293-76ba09a5cb23');
                    if (apiCallDim) dimensionId = apiCallDim.dimensionId;
                    else if (offering.dimensions.length) dimensionId = offering.dimensions[0].dimensionId;
                }
                if (!dimensionId) {
                    if (saasCustomerAssociatedBusinessID === 'meteringco-production') dimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                    else if (saasCustomerAssociatedBusinessID === 'meteringco-sandbox') dimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                    else dimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                    // Try to infer from existing bucket data
                    try {
                        const queryApi = this.influxService.dbclient.getQueryApi(this.influxService.org);
                        const q = `from(bucket: "${TokenConsumerAsyncProcessor.tokenAggregateBucket}") |> range(start: 1970-01-01T00:00:00Z) |> filter(fn: (r) => r["_measurement"] == "${TokenConsumer._measurement}") |> filter(fn: (r) => r["customerId"] == "${meteringcoCustomerId}") |> limit(n:1)`;
                        const rows: any[] = await queryApi.collectRows(q);
                        if (rows.length && rows[0].dimensionId) dimensionId = rows[0].dimensionId;
                    } catch (_) {}
                }

                // Check if period already billed (idempotency + closed period not reopened)
                try {
                    const queryApi = this.influxService.dbclient.getQueryApi(this.influxService.org);
                    const checkQuery = `from(bucket: "${process.env.STAGE}-usage-data") |> range(start: ${endDate.toISOString()}, stop: ${new Date(endDate.getTime() + 2 * 60 * 1000).toISOString()}) |> filter(fn: (r) => r["_measurement"] == "usageMeasurement") |> filter(fn: (r) => r["customerId"] == "${meteringcoCustomerId}") |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}") |> filter(fn: (r) => r["businessID"] == "${saasCustomerAssociatedBusinessID}")`;
                    const existing: any[] = await queryApi.collectRows(checkQuery);
                    if (existing.length > 0) {
                        TokenConsumerAsyncProcessor.logger.log(`Period ${startDate.toISOString()}-${endDate.toISOString()} already billed for ${meteringcoCustomerId}, skipping`);
                        continue;
                    }
                } catch (e) {
                    TokenConsumerAsyncProcessor.logger.warn(`Failed to check existing billing for ${meteringcoCustomerId}`, e);
                }

                // Aggregate
                const agg = await this.influxService.aggregateMeteringCoToken({ customerId: meteringcoCustomerId, startDate, endDate });
                let total = 0;
                if (agg && agg.length > 0) {
                    const val: any = (agg[0] as any)._value;
                    if (val !== null && val !== undefined) total = parseFloat(String(val));
                }
                if (!total || total === 0) {
                    TokenConsumerAsyncProcessor.logger.log(`No traffic for ${meteringcoCustomerId} in window, total 0, skipping billing`);
                    continue;
                }

                // Bill: create token that becomes usage against platform's own account
                // Use tenant businessID so getMeteringCoCustomerId can resolve to platform customer
                await this.tokenConsumerService.create({
                    businessID: info.tenantBusinessID,
                    tokenAmount: total.toString(),
                    timestamp: endDate.toISOString(),
                    metadata: {
                        tokenType: TokenType.apiCall,
                        managed: 'true',
                    },
                    subject,
                });
                TokenConsumerAsyncProcessor.logger.log(`Billed ${total} for ${meteringcoCustomerId} period ${startDate.toISOString()}-${endDate.toISOString()}`);
            }
        } catch (e) {
            TokenConsumerAsyncProcessor.logger.error('Failed to aggregate tokens', e);
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate tokens',
                data: [e],
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
    aggregationFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to aggregate tokens',
            data: job.data,
            topic: AuditScope.ERROR,
        });
    }
}
