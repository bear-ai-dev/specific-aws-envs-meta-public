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
import { UsageEntity } from '../usage/entities/usage.entity';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';

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

    // Register a single API call against the platform's own customer.
    // Must not add a round-trip to the request it describes – we fire-and-forget the write.
    async registerApiCall({
        businessID,
        subject,
        timestamp,
        amount,
        metadata,
    }: {
        businessID: string;
        subject?: string;
        timestamp: string;
        amount: string | number;
        metadata: Record<string, any>;
    }): Promise<void> {
        try {
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                businessID,
                subject,
                this.environmentSerivce,
            );
            if (!res) {
                TokenConsumerService.logger.warn(`No meteringco customer for businessID ${businessID}, skipping apiCall register`);
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = res;
            const dimensionId = await this.resolveApiDimensionId(meteringcoCustomer, saasCustomerAssociatedBusinessID);
            const amountNum = typeof amount === 'string' ? parseFloat(amount) : amount;
            const point = this.influxService.getPoint(TokenConsumer._measurement);
            // Use the call's own moment, not arrival time, for period correctness and late arrival handling
            point.timestamp(new Date(timestamp));
            point.tag('customerId', meteringcoCustomerId);
            point.tag('businessID', saasCustomerAssociatedBusinessID);
            point.tag('dimensionId', dimensionId);
            point.tag('metadata_tokenType', TokenType.apiCall);
            if (metadata && metadata.uuid) {
                point.tag('metadata_uuid', JSON.stringify(metadata.uuid));
            }
            if (metadata) {
                for (const [k, v] of Object.entries(metadata)) {
                    if (k === 'uuid' || k === 'tokenType') continue;
                    // store extra metadata as tags for traceability but not required for dedup
                    try {
                        point.tag(`metadata_${k}`, JSON.stringify(v));
                    } catch {}
                }
            }
            point.floatField('recordValue', isNaN(amountNum) ? 1 : amountNum);
            // fire-and-forget: do not await, so request is not blocked by influx round-trip
            void this.influxService
                .loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, this.influxService.org, [point], true)
                .catch((e) => {
                    TokenConsumerService.logger.error('Failed to register apiCall', serializeError(e));
                    AuditService.publishEvent({
                        topic: AuditScope.ERROR,
                        message: 'Failed to register apiCall',
                        data: [serializeError(e)],
                    });
                });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to register apiCall', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to register apiCall',
                data: [serializeError(e)],
            });
        }
    }

    // Helper for production vs sandbox dimension mapping + dynamic lookup
    private async resolveApiDimensionId(meteringcoCustomer: ReadCustomerResponseData, saasBusinessID: string): Promise<string> {
        // Try dynamic lookup via offering
        try {
            const offeringId = (meteringcoCustomer as any).offeringId || (meteringcoCustomer as any).offering?.offeringId;
            if (offeringId) {
                const { dimensions } = await InfluxService.getMeteringCoOffering(offeringId);
                if (dimensions && dimensions.length) {
                    // Prefer dimension whose name or type hints at apiCall, otherwise first
                    const apiDim = dimensions.find((d: any) => {
                        const name = (d.dimensionName || '').toLowerCase();
                        const type = (d.metadata?.tokenType || '').toLowerCase();
                        return name.includes('api') || type === 'apicall' || d.dimensionId.includes('api');
                    });
                    if (apiDim) return apiDim.dimensionId;
                    // fallback to first dimension
                    if (dimensions[0]?.dimensionId) return dimensions[0].dimensionId;
                }
            }
        } catch {}
        // Fallback to well-known ids observed in ledger (prod vs sandbox) – matches recorded stretch
        if (saasBusinessID === 'meteringco-production') {
            return '697f07d0-3180-4351-bdff-7ca029e6c18d';
        }
        if (saasBusinessID === 'meteringco-sandbox') {
            return '00abdf4f-f975-41c6-8293-76ba09a5cb23';
        }
        // generic fallback
        return '697f07d0-3180-4351-bdff-7ca029e6c18d';
    }

    private resolveBillingDimensionId(saasBusinessID: string): string {
        if (saasBusinessID === 'meteringco-production') return '697f07d0-3180-4351-bdff-7ca029e6c18d';
        if (saasBusinessID === 'meteringco-sandbox') return '00abdf4f-f975-41c6-8293-76ba09a5cb23';
        return '697f07d0-3180-4351-bdff-7ca029e6c18d';
    }

    async create(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO> {
        try {
            TokenConsumerService.logger.debug(
                `Metering Token for businessID: ${meteringcoToken?.businessID}, purpose: ${meteringcoToken?.metadata?.tokenType}`,
            );
            let res = await TokenConsumerService.getMeteringCoCustomerId(
                meteringcoToken.businessID,
                meteringcoToken?.subject,
                this.environmentSerivce,
            );
            // Fallback for platform's own businessIDs (meteringco-production / meteringco-sandbox) which are not mapped via tenant metadata
            if (!res && (meteringcoToken.businessID === 'meteringco-production' || meteringcoToken.businessID === 'meteringco-sandbox')) {
                try {
                    const all = await InfluxService.getMeteringCoCustomers();
                    const match: any = all.find((c: any) => c.businessID === meteringcoToken.businessID);
                    if (match) {
                        const { CustomerEntity } = await import('../customer/entities/customer.entity.js');
                        const entity = CustomerEntity.dbModelToEntity(match);
                        // construct a minimal meteringcoCustomer object for downstream dimension resolution
                        const meteringcoCustomer: any = { ...entity, businessID: match.businessID, customerId: match.customerId, offeringId: (entity as any).offeringId };
                        res = {
                            meteringcoCustomerId: match.customerId,
                            saasCustomerAssociatedBusinessID: match.businessID,
                            meteringcoCustomer,
                        } as any;
                        TokenConsumerService.logger.debug(`Resolved platform businessID ${meteringcoToken.businessID} directly via getMeteringCoCustomers`);
                    }
                } catch (e) {
                    TokenConsumerService.logger.warn(`Fallback lookup for platform businessID ${meteringcoToken.businessID} failed ${e}`);
                }
            }
            if (res) {
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = res;
                TokenConsumerService.logger.debug(`Metering Token for meteringco customerId: ${meteringcoCustomerId}`);
                // When tokenType is apiCall, this is the billing path: turn aggregated total into billable usage
                // For other token types, also create usage but keep existing behavior compatibility
                const tokenType = meteringcoToken?.metadata?.tokenType;
                const amount = parseFloat(meteringcoToken.tokenAmount);
                if (!isNaN(amount)) {
                    // Determine business/dimension for billing – production vs sandbox mapping
                    let billingBusinessID = saasCustomerAssociatedBusinessID;
                    let billingDimensionId: string;
                    // meteringcoCustomer's own businessID tells us prod vs sandbox; use its saasCustomerAssociatedBusinessID already
                    // For apiCall billing, ensure we use prod/sandbox pair; for other types, use same
                    if (tokenType === TokenType.apiCall) {
                        billingDimensionId = this.resolveBillingDimensionId(saasCustomerAssociatedBusinessID);
                    } else {
                        // For offering/customer/metric etc, try to resolve via offering dimensions if possible
                        try {
                            billingDimensionId = await this.resolveApiDimensionId(meteringcoCustomer, saasCustomerAssociatedBusinessID);
                        } catch {
                            billingDimensionId = this.resolveBillingDimensionId(saasCustomerAssociatedBusinessID);
                        }
                    }
                    const measurement: MeasurementFormat = {
                        businessID: billingBusinessID,
                        customerId: meteringcoCustomerId,
                        dimensionId: billingDimensionId,
                        recordValue: amount,
                        timestamp: meteringcoToken.timestamp || new Date().toISOString(),
                        _measurement: UsageEntity._measurement,
                        metadata: meteringcoToken.metadata as any,
                    };
                    const point = MeasurementFormat.getPointForm(measurement as any, this.influxService);
                    await this.influxService.loadPoints(`${process.env.STAGE}-usage-data`, this.influxService.org, [point], true);
                }
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
    // Aggregate one platform customer's traffic for a window and bill it
    async aggregateAndBill({
        customerId,
        saasBusinessID,
        startDate,
        endDate,
    }: {
        customerId: string;
        saasBusinessID: string;
        startDate?: Date;
        endDate?: Date;
    }): Promise<void> {
        let start: Date;
        let end: Date;
        if (startDate && endDate) {
            start = new Date(startDate);
            end = new Date(endDate);
        } else {
            end = new Date();
            start = new Date(end.getTime() - 6 * 60 * 60 * 1000);
        }
        try {
            const rows: any[] = await this.influxService.aggregateMeteringCoToken({
                customerId,
                startDate: start,
                endDate: end,
            });
            let total = 0;
            if (rows && rows.length) {
                for (const r of rows) {
                    const v = (r as any)._value;
                    if (v !== undefined && v !== null && !isNaN(parseFloat(v))) total += parseFloat(v);
                    else if ((r as any)._value === 0) total += 0;
                }
                // Influx sum query may return single row with _value as sum; handle both
                if (rows.length === 1 && total === 0 && (rows[0] as any)._value !== undefined) {
                    total = parseFloat((rows[0] as any)._value) || 0;
                }
            }
            if (total > 0) {
                // Check if this period has already been billed – if usage already exists for this window's end, do not re-open/re-bill (late arrival handling)
                try {
                    const billingDimensionId = this.resolveBillingDimensionId(saasBusinessID);
                    const queryApi = this.influxService.dbclient.getQueryApi(this.influxService.org);
                    // Look for any existing billed usage for this customer/dimension that falls at the window end (with small leeway)
                    const leewayStart = new Date(end.getTime() - 5 * 60 * 1000).toISOString();
                    const leewayEnd = new Date(end.getTime() + 5 * 60 * 1000).toISOString();
                    const existingQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${leewayStart}, stop: ${leewayEnd})
        |> filter(fn: (r) => r["_measurement"] == "${UsageEntity._measurement}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${saasBusinessID}")
        |> filter(fn: (r) => r["dimensionId"] == "${billingDimensionId}")`;
                    const existing: any[] = await queryApi.collectRows(existingQuery);
                    if (existing && existing.length > 0) {
                        TokenConsumerService.logger.debug(`Period already billed for ${customerId} ${saasBusinessID} at ${end.toISOString()}, skipping re-bill (late arrival will be recorded but not re-billed)`);
                        return;
                    }
                } catch (e) {
                    TokenConsumerService.logger.warn(`Failed to check existing billing, proceeding to bill anyway: ${e}`);
                }
                const token = new MeteringCoToken({
                    businessID: saasBusinessID,
                    tokenAmount: total.toString(),
                    metadata: { tokenType: TokenType.apiCall, managed: 'true' } as any,
                    timestamp: end.toISOString(),
                });
                await this.create(token);
            } else {
                TokenConsumerService.logger.debug(`No apiCall traffic for ${customerId} in window ${start.toISOString()} - ${end.toISOString()}`);
            }
        } catch (e) {
            TokenConsumerService.logger.error('Failed to aggregate and bill', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate and bill',
                data: [serializeError(e)],
            });
            throw e;
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
