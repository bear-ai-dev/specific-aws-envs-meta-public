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
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { UsageEntity } from '../usage/entities/usage.entity';
import { TokenConsumer } from './entities/token-consumer.entity';
import { TokenType } from './dto/TokenType';
import { MeteringCoTokenMetadata } from './dto/MeteringCoTokenMetadata';
import { DatetimeUtils } from '../utils/datetime';
import { createHash } from 'crypto';

/**
 * MeteringCo's own account (business) and dimension a metered platform token is billed against.
 */
export type MeteringCoBillingTarget = {
    businessID: string;
    dimensionId: string;
};

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);
    /** MeteringCo's own production account, meteringco customers of production businesses live here */
    public static meteringcoProductionBusinessID = 'meteringco-production';
    /** MeteringCo's own sandbox account, meteringco customers of sandbox businesses live here */
    public static meteringcoSandboxBusinessID = 'meteringco-sandbox';
    /** The dimension platform tokens are metered on inside of MeteringCo's production account */
    public static meteringcoProductionDimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
    /** The dimension platform tokens are metered on inside of MeteringCo's sandbox account */
    public static meteringcoSandboxDimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
    /** The amount of tokens a single API call against the platform consumes */
    public static apiCallTokenAmount = '0.001';
    /** Used when no InfluxService instance is available, ie. inside of an interceptor */
    private static fallbackInfluxService: InfluxService;
    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService?: InfluxService,
    ) {}
    /**
     * MeteringCo does not bill itself with a round trip per API call, the write api buffers
     * these points, hence a single shared InfluxService for all the callers which
     * do not have one injected (interceptors for example).
     */
    public static getInfluxService(influxService?: InfluxService): InfluxService {
        if (influxService) {
            return influxService;
        }
        if (!TokenConsumerService.fallbackInfluxService) {
            TokenConsumerService.fallbackInfluxService = new InfluxService();
        }
        return TokenConsumerService.fallbackInfluxService;
    }
    /**
     * The bucket every registered platform API call is aggregated out of
     */
    public static get tokenAggregateBucket(): string {
        return TokenConsumerAsyncProcessor.tokenAggregateBucket;
    }
    /**
     * Resolves the account/dimension pair inside of MeteringCo's own environment,
     * a meteringco customer belonging to production is billed on the production pair,
     * everything else is billed on the sandbox pair.
     */
    public static getMeteringCoBillingTarget(saasCustomerAssociatedBusinessID: string): MeteringCoBillingTarget {
        if (saasCustomerAssociatedBusinessID === TokenConsumerService.meteringcoProductionBusinessID) {
            return {
                businessID: TokenConsumerService.meteringcoProductionBusinessID,
                dimensionId: TokenConsumerService.meteringcoProductionDimensionId,
            };
        }
        return {
            businessID: TokenConsumerService.meteringcoSandboxBusinessID,
            dimensionId: TokenConsumerService.meteringcoSandboxDimensionId,
        };
    }
    /**
     * Delivery of an API call is at-least-once, the same call can be handed over twice.
     * A call is written at its own moment, tagged with a stable identifier, so a
     * re-delivery lands on the exact same series and time, overwriting itself instead
     * of being counted twice.
     */
    public static callIdentifier(call: {
        businessID?: string;
        customerId?: string;
        dimensionId?: string;
        timestamp?: string;
        recordValue?: string | number;
        metadata?: Record<string, string | number | null>;
    }): string {
        const providedId = call?.metadata?.uuid ?? call?.metadata?.id;
        if (providedId) {
            return providedId.toString();
        }
        const hash = createHash('sha256')
            .update(
                JSON.stringify({
                    businessID: call?.businessID,
                    customerId: call?.customerId,
                    dimensionId: call?.dimensionId,
                    timestamp: call?.timestamp,
                    recordValue: call?.recordValue?.toString(),
                }),
            )
            .digest('hex');
        return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16), hash.slice(16, 20), hash.slice(20, 32)].join(
            '-',
        );
    }
    /**
     * Registers a single API call made against the platform for a business.
     * The call is metered against MeteringCo's own customer for that business and is
     * recorded at the moment the call happened, no matter how late it arrived,
     * so a late arrival never lands in a period it did not happen in.
     *
     * The point is buffered (not flushed) so registering a call never adds a round
     * trip to the request which is being described.
     */
    public static async registerApiCall(
        meteringcoToken: MeteringCoToken,
        environmentSerivce?: EnvironmentService,
        influxService?: InfluxService,
    ): Promise<BasicResponseDTO | void> {
        try {
            const token = new MeteringCoToken({
                ...meteringcoToken,
                tokenAmount: meteringcoToken?.tokenAmount ?? TokenConsumerService.apiCallTokenAmount,
                metadata: {
                    tokenType: TokenType.apiCall,
                    ...(meteringcoToken?.metadata || {}),
                } as MeteringCoTokenMetadata,
            });
            TokenConsumerService.logger.debug(
                `Registering API call for businessID: ${token?.businessID}, at: ${token?.timestamp}`,
            );
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token?.subject,
                environmentSerivce,
            );
            if (!res) {
                TokenConsumerService.logger.error(`No customer found for businessID: ${token?.businessID}`);
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const { businessID, dimensionId } = TokenConsumerService.getMeteringCoBillingTarget(
                saasCustomerAssociatedBusinessID,
            );
            const influx = TokenConsumerService.getInfluxService(influxService);
            const point = MeasurementFormat.getPointForm(
                {
                    customerId: meteringcoCustomerId,
                    dimensionId,
                    businessID,
                    // The moment of the call itself, never the moment it reached us
                    timestamp: token.timestamp,
                    recordValue: parseFloat(token.tokenAmount),
                    metadata: token.metadata,
                    _measurement: TokenConsumer._measurement,
                },
                influx,
            );
            await influx.loadPoints(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
                [point],
                // Never flush in the request path
                false,
            );
            return { message: `Registered API call for businessID: ${token?.businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to register API call', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to register API call',
                data: [serializeError(e)],
            });
        }
    }
    /**
     * @see TokenConsumerService.registerApiCall
     */
    public static register(
        meteringcoToken: MeteringCoToken,
        environmentSerivce?: EnvironmentService,
        influxService?: InfluxService,
    ): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerApiCall(meteringcoToken, environmentSerivce, influxService);
    }
    /**
     * @see TokenConsumerService.registerApiCall
     */
    public static registerToken(
        meteringcoToken: MeteringCoToken,
        environmentSerivce?: EnvironmentService,
        influxService?: InfluxService,
    ): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerApiCall(meteringcoToken, environmentSerivce, influxService);
    }
    /**
     * Registers a single API call made against the platform,
     * @see TokenConsumerService.registerApiCall
     */
    async register(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerApiCall(
            meteringcoToken,
            this.environmentSerivce,
            TokenConsumerService.getInfluxService(this.influxService),
        );
    }
    /**
     * @see TokenConsumerService.registerApiCall
     */
    async registerApiCall(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.register(meteringcoToken);
    }
    /**
     * @see TokenConsumerService.registerApiCall
     */
    async registerToken(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.register(meteringcoToken);
    }
    /**
     * Closes a period of registered platform API calls for a single meteringco customer.
     * When no window is given the six hours behind now are closed.
     * The total of the window becomes a single token for the period which is then
     * turned into billable usage against MeteringCo's own account.
     *
     * Calls belonging to a period which was already closed are still recorded at their
     * own moment, but the closed period is never re-opened to bill them, so an invoice
     * which was already issued can not move.
     */
    async aggregateTokens({
        businessID,
        subject,
        startDate,
        endDate,
        customerId,
    }: {
        businessID: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
        customerId?: string;
    }): Promise<BasicResponseDTO | void> {
        try {
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res && !customerId) {
                TokenConsumerService.logger.error(`No customer found for businessID: ${businessID}`);
                return;
            }
            const meteringcoCustomerId = customerId || (res ? res.meteringcoCustomerId : undefined);
            const periodEnd = endDate ? new Date(endDate) : new Date();
            const periodStart = startDate ? new Date(startDate) : DatetimeUtils.sixHoursAgo(periodEnd);
            TokenConsumerService.logger.log(
                `Aggregating registered API calls for meteringco customerId: ${meteringcoCustomerId} between ${periodStart.toISOString()} and ${periodEnd.toISOString()}`,
            );
            const rows = await TokenConsumerService.getInfluxService(this.influxService).aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: periodStart,
                endDate: periodEnd,
            });
            const total = (rows || []).reduce((acc, row) => {
                const value = Number(row?._value);
                return Number.isFinite(value) ? acc + value : acc;
            }, 0);
            if (!total) {
                TokenConsumerService.logger.log(
                    `No registered API calls found for meteringco customerId: ${meteringcoCustomerId} in the given period`,
                );
                return { message: `No tokens to meter for businessID: ${businessID}` };
            }
            // Guard against floating point noise gathered while summing the period
            const tokenAmount = parseFloat(total.toFixed(6)).toString();
            return this.create({
                businessID,
                subject,
                tokenAmount,
                metadata: {
                    tokenType: TokenType.apiCall,
                    managed: 'true',
                },
            });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to aggregate MeteringCo tokens', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate MeteringCo tokens',
                data: [serializeError(e)],
            });
        }
    }
    /**
     * @see TokenConsumerService.aggregateTokens
     */
    async aggregate(input: {
        businessID: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
        customerId?: string;
    }): Promise<BasicResponseDTO | void> {
        return this.aggregateTokens(input);
    }
    /**
     * @see TokenConsumerService.aggregateTokens
     */
    async aggregateMeteringCoTokens(input: {
        businessID: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
        customerId?: string;
    }): Promise<BasicResponseDTO | void> {
        return this.aggregateTokens(input);
    }
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
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
                TokenConsumerService.logger.debug(`Metering Token for meteringco customerId: ${meteringcoCustomerId}`);
                const token = new MeteringCoToken(meteringcoToken);
                const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, saasCustomerAssociatedBusinessID);
                const { businessID, dimensionId } = TokenConsumerService.getMeteringCoBillingTarget(
                    tokenConsumer.saasCustomerAssociatedBusinessID,
                );
                const influx = TokenConsumerService.getInfluxService(this.influxService);
                const point = MeasurementFormat.getPointForm(
                    {
                        customerId: tokenConsumer.customerId,
                        dimensionId,
                        businessID,
                        timestamp: tokenConsumer.timestamp,
                        recordValue: parseFloat(tokenConsumer.tokenAmount),
                        metadata: tokenConsumer.metadata,
                        _measurement: UsageEntity._measurement,
                    },
                    influx,
                );
                TokenConsumerService.logger.log(
                    `Metering ${tokenConsumer.tokenAmount} tokens as usage for meteringco customerId: ${tokenConsumer.customerId} on dimensionId: ${dimensionId} in businessID: ${businessID}`,
                );
                await influx.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
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
            await this.scheduleTokenAggregator({ businessID, subject });
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
    /**
     * Schedules the job which closes a period of registered platform API calls,
     * it runs every six hours and closes the six hours behind it.
     */
    async scheduleTokenAggregator({
        businessID,
        subject,
    }: {
        businessID: string;
        subject?: string;
    }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Scheduling token aggregator for businessID: ${businessID}`);
            await this.schedulerService.create({
                businessID,
                schedulerStatus: SchedulerStatus.live,
                subject,
                schedulerID: TokenConsumerAsyncProcessor.aggregationSchedulerIdGenerator(businessID),
                schedulerType: schedulerType.dimensionDataGathering,
                scheduleParameters: {
                    businessID,
                    subject,
                    dimensionType: TokenConsumerAsyncProcessor.aggregationProcessor,
                },
                rate: SupportedMeasurementFrequencies.everySixHours,
            });
            return { message: `Token Aggregator scheduled for businessID: ${businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to schedule token aggregator', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to schedule token aggregator',
                data: [serializeError(e)],
            });
        }
    }
    async removeTokenAggregator({ businessID }: { businessID: string }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Removing token aggregator for businessID: ${businessID}`);
            await this.schedulerService.remove({
                businessID,
                schedulerID: TokenConsumerAsyncProcessor.aggregationSchedulerIdGenerator(businessID),
            });
            return { message: `Token Aggregator removed for businessID: ${businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to remove token aggregator', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to remove token aggregator',
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
            await this.removeTokenAggregator({ businessID });
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
