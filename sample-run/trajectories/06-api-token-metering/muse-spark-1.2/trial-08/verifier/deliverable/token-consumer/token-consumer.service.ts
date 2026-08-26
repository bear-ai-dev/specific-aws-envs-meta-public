import { BadRequestException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { MeteringCoToken } from './dto/meteringcoToken.dto';
import { UserEntitlements } from '../users/entities/entitlement.entity';
import { cache as cacheManager } from '../cacheStore.js';
import { BasicResponseDTO } from '../basicResponseDTO';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { serializeError } from 'serialize-error';
import { SchedulerService } from '../scheduler/scheduler.service';
import { SchedulerStatus, SupportedMeasurementFrequencies, schedulerType } from '../scheduler/dto/scheduler.dto';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor';
import { ReadCustomerResponseData } from '../customer/entities/customer.entity';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { TokenConsumer } from './entities/token-consumer.entity';
import { TokenType } from './dto/TokenType';

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);
    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
    ) {}
    async create(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO> {
        try {
            TokenConsumerService.logger.debug(
                `Metering Token for businessID: ${meteringcoToken?.businessID}, purpose: ${meteringcoToken?.metadata?.tokenType}`,
            );
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                meteringcoToken.businessID,
                meteringcoToken?.subject,
                this.environmentSerivce,
            );
            if (res) {
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = res;
                TokenConsumerService.logger.debug(`Metering Token for meteringco customerId: ${meteringcoCustomerId}`);
                // Determine target business and dimension for billing
                const isProd = meteringcoCustomer.businessID === 'meteringco-production' || saasCustomerAssociatedBusinessID === 'meteringco-production';
                const targetBusinessID = isProd ? 'meteringco-production' : 'meteringco-sandbox';
                const dimensionId = isProd ? '697f07d0-3180-4351-bdff-7ca029e6c18d' : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                // Check if usage already exists for this period to keep idempotency for closed periods
                // Look for any usage in a 5 second window around the billing timestamp to catch previous bills
                try {
                    const ts = new Date(meteringcoToken.timestamp);
                    const queryApi = this.influxService.queryAPIInstance();
                    // Search 5 seconds before and after to find existing bill for this period
                    const searchStart = new Date(ts.getTime() - 5000).toISOString();
                    const searchEnd = new Date(ts.getTime() + 5000).toISOString();
                    const flux = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${searchStart}, stop: ${searchEnd})
        |> filter(fn: (r) => r["_measurement"] == "usageMeasurement")
        |> filter(fn: (r) => r["businessID"] == "${targetBusinessID}")
        |> filter(fn: (r) => r["customerId"] == "${meteringcoCustomerId}")
        |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")`;
                    const existing: any[] = await queryApi.collectRows(flux);
                    if (existing && existing.length > 0) {
                        // Already billed for this period - do not move invoice
                        // Also check if any point has _time within 5 sec of ts, if so skip
                        const hasClose = existing.some((row: any) => {
                            const rowTime = new Date(row._time).getTime();
                            return Math.abs(rowTime - ts.getTime()) < 5000;
                        });
                        if (hasClose) {
                            TokenConsumerService.logger.debug(`Usage already exists for period ${meteringcoToken.timestamp}, skipping bill`);
                            return { message: `Token Consumer already billed for businessID: ${meteringcoToken?.businessID}` };
                        }
                    }
                } catch (e) {
                    TokenConsumerService.logger.warn('Failed to check existing usage, proceeding to bill', serializeError(e));
                }
                const point = this.influxService.getPoint('usageMeasurement');
                point.tag('businessID', targetBusinessID);
                point.tag('customerId', meteringcoCustomerId);
                point.tag('dimensionId', dimensionId);
                point.tag('metadata_tokenType', JSON.stringify(meteringcoToken.metadata?.tokenType || TokenType.apiCall));
                point.tag('metadata_managed', JSON.stringify('true'));
                // copy additional metadata if any (excluding tokenType)
                if (meteringcoToken.metadata) {
                    Object.keys(meteringcoToken.metadata).forEach((k) => {
                        if (k === 'tokenType' || k === 'managed') return;
                        point.tag(`metadata_${k}`, JSON.stringify(meteringcoToken.metadata[k]));
                    });
                }
                const amount = parseFloat(meteringcoToken.tokenAmount);
                point.floatField('recordValue', isNaN(amount) ? 0 : amount);
                point.timestamp(new Date(meteringcoToken.timestamp));
                await this.influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
                return { message: `Token Consumer created for businessID: ${meteringcoToken?.businessID}` };
            } else {
                TokenConsumerService.logger.error(`No customer found for businessID: ${meteringcoToken?.businessID}`);
                throw new BadRequestException(`No customer found for businessID: ${meteringcoToken?.businessID}`);
            }
        } catch (e) {
            TokenConsumerService.logger.error('Failed to create Token Consumer', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to create Token Consumer',
                data: [serializeError(e)],
            });
        }
    }
    public static async getMeteringCoCustomerId(
        businessID: string,
        subject?: string,
        environmentSerivce?: EnvironmentService,
    ): Promise<{
        meteringcoCustomerId: string;
        saasCustomerAssociatedBusinessID: string;
        meteringcoCustomer: ReadCustomerResponseData;
    } | void> {
        const jsonBlob: string = await cacheManager.get(TokenConsumerService.cacheKey(businessID));
        let meteringcoCustomerId: string;
        let saasCustomerAssociatedBusinessID: string;
        let meteringcoCustomer: ReadCustomerResponseData;
        if (!jsonBlob) {
            let businessIDs: string[] = [];
            if (subject) {
                const allEnvs = await environmentSerivce.getEnvironmentsForUser(subject);
                businessIDs = allEnvs.map((env) => env.businessID);
            } else {
                businessIDs = [businessID];
            }
            const { data } = await UserEntitlements.queryForMeteringCoCustomer({
                businessIDs,
            });
            if (data.length) {
                TokenConsumerService.logger.debug(
                    `Storing customer: ${data[0].customerId} for businessID: ${data[0].businessID} in token cache`,
                );
                await cacheManager.set(
                    TokenConsumerService.cacheKey(businessID),
                    JSON.stringify({
                        customerId: data[0].customerId,
                        saasCustomerAssociatedBusinessID: data[0].businessID,
                        customerRes: data[0],
                    }),
                );
            } else {
                TokenConsumerService.logger.error(`No customer found for businessID: ${businessID}`);
                return;
            }
            meteringcoCustomerId = data[0].customerId;
            saasCustomerAssociatedBusinessID = data[0].businessID;
            meteringcoCustomer = data[0];
        } else {
            const parsedJson = JSON.parse(jsonBlob);
            TokenConsumerService.logger.debug(
                `Retrieved customer: ${parsedJson.customerId} from token cache with MeteringCoBusinessID: ${parsedJson.saasCustomerAssociatedBusinessID}`,
            );
            meteringcoCustomerId = parsedJson.customerId;
            saasCustomerAssociatedBusinessID = parsedJson.saasCustomerAssociatedBusinessID;
            meteringcoCustomer = parsedJson.customerRes;
        }
        return { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer };
    }
    async recordApiCall({
        businessID,
        subject,
        amount,
        timestamp,
        metadata,
    }: {
        businessID: string;
        subject?: string;
        amount: string | number;
        timestamp: string;
        metadata: Record<string, string>;
    }): Promise<void> {
        try {
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.error(`No meteringco customer for businessID ${businessID} - dropping api call record`);
                return;
            }
            const { meteringcoCustomerId, meteringcoCustomer } = res;
            const isProd = meteringcoCustomer.businessID === 'meteringco-production';
            const targetBusinessID = isProd ? 'meteringco-production' : 'meteringco-sandbox';
            const dimensionId = isProd ? '697f07d0-3180-4351-bdff-7ca029e6c18d' : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
            const point = this.influxService.getPoint(TokenConsumer._measurement);
            point.tag('businessID', targetBusinessID);
            point.tag('customerId', meteringcoCustomerId);
            point.tag('dimensionId', dimensionId);
            point.tag('metadata_tokenType', JSON.stringify(TokenType.apiCall));
            if (metadata && metadata.uuid) {
                point.tag('metadata_uuid', JSON.stringify(metadata.uuid));
            }
            // add any other metadata tags
            if (metadata) {
                Object.keys(metadata).forEach((k) => {
                    if (k === 'uuid' || k === 'tokenType') return;
                    point.tag(`metadata_${k}`, JSON.stringify(metadata[k]));
                });
            }
            const amt = typeof amount === 'string' ? parseFloat(amount) : amount;
            point.floatField('recordValue', isNaN(amt as number) ? 0 : (amt as number));
            point.timestamp(new Date(timestamp));
            // Must not add round trip - use flush false and do not await blocking the request
            // Fire and forget but handle errors
            void this.influxService.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, process.env.INFLUX_ORG, [point], false).catch((e) => {
                TokenConsumerService.logger.error('Failed to record api call', serializeError(e));
                AuditService.publishEvent({ topic: AuditScope.ERROR, message: 'Failed to record api call', data: [serializeError(e)] });
            });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to record api call', serializeError(e));
        }
    }
    async scheduleTokenProcessor({
        businessID,
        subject,
    }: {
        businessID: string;
        subject: string;
    }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Scheduling token processor for businessID: ${businessID}`);
            await this.schedulerService.create({
                businessID,
                schedulerStatus: SchedulerStatus.live,
                subject,
                schedulerID: TokenConsumerAsyncProcessor.schedulerIdGenerator(businessID),
                schedulerType: schedulerType.dimensionDataGathering,
                scheduleParameters: {
                    businessID,
                    subject,
                    dimensionType: TokenConsumerAsyncProcessor.processorName,
                },
                rate: SupportedMeasurementFrequencies.monthlyAtNoon,
            });
            return { message: `Token Processor scheduled for businessID: ${businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to schedule token processor', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to schedule token processor',
                data: [serializeError(e)],
            });
        }
    }
    async removeTokenProcessor({ businessID }: { businessID: string }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Removing token processor for businessID: ${businessID}`);
            await this.schedulerService.remove({
                businessID,
                schedulerID: TokenConsumerAsyncProcessor.schedulerIdGenerator(businessID),
            });
            return { message: `Token Processor removed for businessID: ${businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to remove token processor', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to remove token processor',
                data: [serializeError(e)],
            });
        }
    }

    async findAll({ businessID }: { businessID: string }): Promise<{ access_token: string }> {
        try {
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID);
            if (res) {
                TokenConsumerService.logger.debug(`Finding meteringco token usage for businessID: ${businessID}`);
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = res;

                const tokenUsageRes = await this.localJWTAuthService.signIn(
                    meteringcoCustomerId,
                    saasCustomerAssociatedBusinessID,
                );
                TokenConsumerService.logger.debug(
                    `Found meteringco token usage for businessID: ${businessID}, meteringcoCustomerId: ${meteringcoCustomerId} and saasCustomerAssociatedBusinessID: ${saasCustomerAssociatedBusinessID}`,
                );
                return tokenUsageRes;
            } else {
                return { access_token: '' };
            }
        } catch (e) {
            TokenConsumerService.logger.error('Failed to find meteringco token usage', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to find meteringco token usage',
                data: [serializeError(e)],
            });
            return { access_token: '' };
        }
    }
}
