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
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity';
import { UsageEntity } from '../usage/entities/usage.entity';
import { TokenType } from './dto/TokenType';

export const SIX_HOURS_IN_MS = 216e5;

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);
    /**
     * MeteringCo's own (dogfood) production account, and the dimension api call usage is metered against within it.
     */
    public static meteringcoProductionBusinessID = 'meteringco-production';
    public static meteringcoProductionApiCallDimensionId =
        process.env.METERINGCO_PRODUCTION_API_CALL_DIMENSION_ID || '697f07d0-3180-4351-bdff-7ca029e6c18d';
    /**
     * MeteringCo's own (dogfood) sandbox account, and the dimension api call usage is metered against within it.
     */
    public static meteringcoSandboxBusinessID = 'meteringco-sandbox';
    public static meteringcoSandboxApiCallDimensionId =
        process.env.METERINGCO_SANDBOX_API_CALL_DIMENSION_ID || '00abdf4f-f975-41c6-8293-76ba09a5cb23';
    /**
     * The amount of tokens a single API call to the platform is worth.
     */
    public static apiCallTokenAmount = process.env.METERINGCO_API_CALL_TOKEN_AMOUNT || '0.001';
    /**
     * The period which the token aggregation (period closing) job covers.
     */
    public static aggregationPeriodInMs = SIX_HOURS_IN_MS;
    public static aggregationRate = SupportedMeasurementFrequencies.everySixHours;
    public static aggregationSchedulerIdGenerator = (businessID: string) =>
        `${TokenConsumerAsyncProcessor.aggregationProcessor}-${businessID}`;
    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
    ) {}
    /**
     * Resolves which MeteringCo (dogfood) account, and which dimension within it, usage for a given
     * meteringco customer should be metered against. Production customers are metered against the
     * production account/dimension pair, everything else against the sandbox pair.
     */
    public static meteringcoAccountForCustomer(saasCustomerAssociatedBusinessID?: string): {
        businessID: string;
        dimensionId: string;
    } {
        if (saasCustomerAssociatedBusinessID === TokenConsumerService.meteringcoProductionBusinessID) {
            return {
                businessID: TokenConsumerService.meteringcoProductionBusinessID,
                dimensionId: TokenConsumerService.meteringcoProductionApiCallDimensionId,
            };
        }
        return {
            businessID: TokenConsumerService.meteringcoSandboxBusinessID,
            dimensionId: TokenConsumerService.meteringcoSandboxApiCallDimensionId,
        };
    }
    /**
     * Registers a single unit of platform traffic (an API call, or an accepted measurement) against
     * the meteringco customer which represents the tenant making the call.
     *
     * The point is written into the token aggregate bucket at the moment the call happened, and is
     * uniquely identified by its metadata (tags) + timestamp. Which means:
     *  - a call handed to us twice (at-least-once delivery) overwrites itself instead of being counted twice
     *  - a call handed to us late (unordered delivery) is still recorded in the period it happened in
     *
     * The write is buffered (not flushed), so registering a call never adds a round trip to the
     * request which is being metered.
     */
    public static async registerToken(
        meteringcoToken: MeteringCoToken,
        influxService: InfluxService,
        environmentSerivce?: EnvironmentService,
    ): Promise<BasicResponseDTO | void> {
        try {
            const token = new MeteringCoToken(meteringcoToken);
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token.subject,
                environmentSerivce,
            );
            if (!res) {
                TokenConsumerService.logger.error(`No customer found for businessID: ${token?.businessID}`);
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.meteringcoAccountForCustomer(
                saasCustomerAssociatedBusinessID,
            );
            const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, saasCustomerAssociatedBusinessID);
            const point = MeasurementFormat.getPointForm(
                {
                    customerId: meteringcoCustomerId,
                    dimensionId,
                    businessID: meteringcoBusinessID,
                    recordValue: parseFloat(tokenConsumer.tokenAmount),
                    // The moment the call happened, never the moment it reached us.
                    timestamp: tokenConsumer.timestamp,
                    metadata: tokenConsumer.metadata,
                    _measurement: TokenConsumer._measurement,
                },
                influxService,
            );
            TokenConsumerService.logger.debug(
                `Registering token for meteringco customerId: ${meteringcoCustomerId}, amount: ${tokenConsumer.tokenAmount}, timestamp: ${tokenConsumer.timestamp}`,
            );
            // flush = false, registering a token must not add a round trip to the metered request.
            await influxService.loadPoints(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
                [point],
                false,
            );
            return { message: `Token registered for businessID: ${token?.businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to register Token', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to register Token',
                data: [serializeError(e)],
            });
        }
    }
    async registerToken(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerToken(meteringcoToken, this.influxService, this.environmentSerivce);
    }
    /**
     * Alias of {@link TokenConsumerService.registerToken}
     */
    async register(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.registerToken(meteringcoToken);
    }
    /**
     * Registers a single API call made by a tenant against meteringco's own metering.
     */
    async registerApiCall({
        businessID,
        subject,
        metadata,
        timestamp,
        tokenAmount,
    }: {
        businessID: string;
        subject?: string;
        metadata?: Record<string, string>;
        timestamp?: string;
        tokenAmount?: string;
    }): Promise<BasicResponseDTO | void> {
        return this.registerToken({
            businessID,
            subject,
            tokenAmount: tokenAmount ? tokenAmount : TokenConsumerService.apiCallTokenAmount,
            timestamp,
            metadata: {
                ...(metadata || {}),
                tokenType: TokenType.apiCall,
            },
        } as MeteringCoToken);
    }
    /**
     * Closes a period of registered platform traffic for a single meteringco customer.
     * When no window is given the six hours behind now are closed.
     *
     * The total registered in the window becomes one token for that period, which is
     * then turned into billable usage against meteringco's own account.
     */
    async aggregateTokens({
        businessID,
        subject,
        startDate,
        endDate,
    }: {
        businessID: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
    }): Promise<BasicResponseDTO | void> {
        try {
            const periodEnd = endDate ? new Date(endDate) : new Date();
            const periodStart = startDate
                ? new Date(startDate)
                : new Date(periodEnd.getTime() - TokenConsumerService.aggregationPeriodInMs);
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.error(`No customer found for businessID: ${businessID}`);
                return;
            }
            const { meteringcoCustomerId } = res;
            // Registered calls are buffered, make sure everything which has been handed over
            // is in the store before the period is totalled.
            await this.influxService.loadPoints(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
                [],
                true,
            );
            TokenConsumerService.logger.debug(
                `Aggregating tokens for meteringco customerId: ${meteringcoCustomerId} between ${periodStart.toISOString()} and ${periodEnd.toISOString()}`,
            );
            const rows = await this.influxService.aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: periodStart,
                endDate: periodEnd,
            });
            const total = TokenConsumerService.sumTokens(rows);
            TokenConsumerService.logger.debug(
                `Aggregated token total: ${total} for meteringco customerId: ${meteringcoCustomerId}`,
            );
            if (!total) {
                return { message: `No tokens to aggregate for businessID: ${businessID}` };
            }
            await this.create({
                businessID,
                subject,
                tokenAmount: total.toString(),
                metadata: {
                    tokenType: TokenType.apiCall,
                    managed: 'true',
                },
            });
            return { message: `Tokens aggregated for businessID: ${businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to aggregate Tokens', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate Tokens',
                data: [serializeError(e)],
            });
        }
    }
    public static sumTokens(rows: { _value?: string | number | boolean }[]): number {
        if (!rows?.length) {
            return 0;
        }
        const total = rows.reduce((acc, row) => acc + (row?._value ? Number(row._value) : 0), 0);
        // Guard against floating point noise introduced by summing token amounts.
        return Number(total.toFixed(10));
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
                const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.meteringcoAccountForCustomer(
                    saasCustomerAssociatedBusinessID,
                );
                const entity = new StandardMeasurementEntity({
                    customerId: meteringcoCustomerId,
                    dimensionId,
                    businessID: meteringcoBusinessID,
                    recordValue: parseFloat(token.tokenAmount),
                    timestamp: token.timestamp,
                    metadata: token.metadata,
                    _measurement: UsageEntity._measurement,
                });
                const point = MeasurementFormat.getPointForm(entity, this.influxService);
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
     * Schedules the job which closes, and bills, a period of registered platform traffic.
     * The job runs every six hours, and each run closes the six hours behind it.
     */
    async scheduleTokenAggregator({
        businessID,
        subject,
    }: {
        businessID: string;
        subject: string;
    }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Scheduling token aggregator for businessID: ${businessID}`);
            await this.schedulerService.create({
                businessID,
                schedulerStatus: SchedulerStatus.live,
                subject,
                schedulerID: TokenConsumerService.aggregationSchedulerIdGenerator(businessID),
                schedulerType: schedulerType.dimensionDataGathering,
                scheduleParameters: {
                    businessID,
                    subject,
                    dimensionType: TokenConsumerAsyncProcessor.aggregationProcessor,
                },
                rate: TokenConsumerService.aggregationRate,
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
    async removeTokenProcessor({ businessID }: { businessID: string }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Removing token processor for businessID: ${businessID}`);
            await this.schedulerService.remove({
                businessID,
                schedulerID: TokenConsumerAsyncProcessor.schedulerIdGenerator(businessID),
            });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to remove token processor', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to remove token processor',
                data: [serializeError(e)],
            });
        }
        await this.removeTokenAggregator({ businessID });
        return { message: `Token Processor removed for businessID: ${businessID}` };
    }
    async removeTokenAggregator({ businessID }: { businessID: string }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Removing token aggregator for businessID: ${businessID}`);
            await this.schedulerService.remove({
                businessID,
                schedulerID: TokenConsumerService.aggregationSchedulerIdGenerator(businessID),
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
