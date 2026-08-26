import { BadRequestException, Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
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
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { UsageEntity } from '../usage/entities/usage.entity';

const SIX_HOURS_IN_MS = 216e5;

export type MeteringCoAccount = {
    businessID: string;
    dimensionId: string;
};

export type AggregateTokenInput = {
    businessID: string;
    subject?: string;
    startDate?: string | Date;
    endDate?: string | Date;
};

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);
    /**
     * MeteringCo's own production account, and the dimension api call traffic is billed against on it.
     */
    public static meteringcoProductionBusinessID = 'meteringco-production';
    public static meteringcoProductionDimensionId =
        process.env.METERINGCO_PRODUCTION_TOKEN_DIMENSION_ID || '697f07d0-3180-4351-bdff-7ca029e6c18d';
    /**
     * MeteringCo's own sandbox account, and the dimension api call traffic is billed against on it.
     */
    public static meteringcoSandboxBusinessID = 'meteringco-sandbox';
    public static meteringcoSandboxDimensionId =
        process.env.METERINGCO_SANDBOX_TOKEN_DIMENSION_ID || '00abdf4f-f975-41c6-8293-76ba09a5cb23';
    /**
     * The amount of token consumed by a single API call.
     */
    public static apiCallTokenAmount = process.env.METERINGCO_API_CALL_TOKEN_AMOUNT || '0.001';
    /**
     * The length of a metering period. The aggregation job runs at the same cadence.
     */
    public static aggregationWindowInMs = SIX_HOURS_IN_MS;

    readonly influxService: InfluxService;
    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Optional() @Inject(forwardRef(() => InfluxService)) influxService?: InfluxService,
    ) {
        this.influxService = influxService ? influxService : new InfluxService();
    }

    /**
     * Turns a token into billable usage against meteringco's own account.
     *
     * The token is billed against the production account (and its dimension) when the meteringco
     * customer lives in production, and against the sandbox pair otherwise.
     */
    async create(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO> {
        try {
            TokenConsumerService.logger.debug(
                `Metering Token for businessID: ${meteringcoToken?.businessID}, purpose: ${meteringcoToken?.metadata?.tokenType}`,
            );
            const token = new MeteringCoToken(meteringcoToken);
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token?.subject,
                this.environmentSerivce,
            );
            if (res) {
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
                TokenConsumerService.logger.debug(`Metering Token for meteringco customerId: ${meteringcoCustomerId}`);
                const recordValue = parseFloat(token.tokenAmount);
                if (!Number.isFinite(recordValue)) {
                    throw new BadRequestException(
                        `Invalid token amount: ${token.tokenAmount} for businessID: ${token.businessID}`,
                    );
                }
                const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.getMeteringCoAccount(
                    saasCustomerAssociatedBusinessID,
                );
                const entity = new StandardMeasurementEntity({
                    _measurement: UsageEntity._measurement,
                    businessID: meteringcoBusinessID,
                    customerId: meteringcoCustomerId,
                    dimensionId,
                    timestamp: token.timestamp,
                    recordValue,
                    metadata: token.metadata,
                });
                const point = MeasurementFormat.getPointForm(entity, this.influxService);
                await this.influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
                TokenConsumerService.logger.debug(
                    `Metered ${token.tokenAmount} token(s) as usage for meteringco customerId: ${meteringcoCustomerId}, businessID: ${meteringcoBusinessID}, dimensionId: ${dimensionId}`,
                );
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

    /**
     * Registers a single unit of meteringco's own product (for example an API call served, or a
     * measurement accepted) against the meteringco customer of the SaaS business which caused it.
     *
     * The point is buffered, and written at the moment the event occurred, which means:
     *  - registering never adds a round trip to the request which is being metered.
     *  - a repeated delivery of the same event overwrites itself rather than being counted twice.
     *  - a late, or out of order, arrival is recorded in the period it happened in, and an
     *    already closed (billed) period is never re-opened, nor is the event dropped.
     */
    async register(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerToken(meteringcoToken, this.influxService, this.environmentSerivce);
    }

    /**
     * @see register
     */
    async registerToken(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.register(meteringcoToken);
    }

    /**
     * Registers one API call, @see register
     */
    async registerApiCall(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.register({
            ...meteringcoToken,
            tokenAmount: meteringcoToken?.tokenAmount ? meteringcoToken.tokenAmount : TokenConsumerService.apiCallTokenAmount,
            metadata: { tokenType: TokenType.apiCall, ...meteringcoToken?.metadata },
        });
    }

    public static async registerToken(
        meteringcoToken: MeteringCoToken,
        influxService: InfluxService,
        environmentSerivce?: EnvironmentService,
        meteringcoCustomerData?: {
            meteringcoCustomerId: string;
            saasCustomerAssociatedBusinessID: string;
        },
    ): Promise<BasicResponseDTO | void> {
        try {
            const token = new MeteringCoToken({
                ...meteringcoToken,
                tokenAmount: meteringcoToken?.tokenAmount ? meteringcoToken.tokenAmount : TokenConsumerService.apiCallTokenAmount,
            });
            const res = meteringcoCustomerData
                ? meteringcoCustomerData
                : await TokenConsumerService.getMeteringCoCustomerId(token.businessID, token?.subject, environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.error(
                    `No meteringco customer found for businessID: ${token?.businessID}, unable to register token`,
                );
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const { dimensionId, businessID: meteringcoBusinessID } = TokenConsumerService.getMeteringCoAccount(
                saasCustomerAssociatedBusinessID,
            );
            const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, meteringcoBusinessID, dimensionId);
            const point = TokenConsumer.getPointForm(tokenConsumer, influxService);
            // Buffered write, no flush, registering a call must not add a round trip to the
            // request which it describes.
            await influxService.loadPoints(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
                [point],
                false,
            );
            TokenConsumerService.logger.debug(
                `Registered ${token.tokenAmount} token(s) for meteringco customerId: ${meteringcoCustomerId} at ${token.timestamp}`,
            );
            return { message: `Token registered for businessID: ${token?.businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to register token', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to register token',
                data: [serializeError(e)],
            });
        }
    }

    /**
     * Closes a metering period.
     *
     * Totals every token registered for a single meteringco customer inside of the window and turns
     * that total into one token for the period, which in turn becomes billable usage.
     * When no window is given the six hours behind now are closed.
     */
    async aggregateTokens({
        businessID,
        subject,
        startDate,
        endDate,
    }: AggregateTokenInput): Promise<BasicResponseDTO | void> {
        try {
            const { startDate: start, endDate: end } = TokenConsumerService.resolveAggregationWindow({
                startDate,
                endDate,
            });
            TokenConsumerService.logger.debug(
                `Aggregating tokens for businessID: ${businessID} between ${start.toISOString()} and ${end.toISOString()}`,
            );
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.error(
                    `No meteringco customer found for businessID: ${businessID}, unable to aggregate tokens`,
                );
                return;
            }
            const { meteringcoCustomerId } = res;
            // Any buffered registrations must be committed before the period can be totalled.
            await this.influxService.flushBucket(TokenConsumerAsyncProcessor.tokenAggregateBucket);
            const aggregateRes = await this.influxService.aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: start,
                endDate: end,
            });
            const tokenAmount = TokenConsumerService.sumAggregateResponse(aggregateRes);
            if (!tokenAmount) {
                TokenConsumerService.logger.debug(
                    `No tokens registered for meteringco customerId: ${meteringcoCustomerId} between ${start.toISOString()} and ${end.toISOString()}`,
                );
                return { message: `No tokens to meter for businessID: ${businessID}` };
            }
            TokenConsumerService.logger.debug(
                `Aggregated ${tokenAmount} token(s) for meteringco customerId: ${meteringcoCustomerId}`,
            );
            return await this.create({
                businessID,
                subject,
                tokenAmount: tokenAmount.toString(),
                // The token belongs to the period it closes, not to the moment the job ran, so
                // re-running the same period re-writes the same usage instead of billing it twice.
                timestamp: end.toISOString(),
                metadata: {
                    tokenType: TokenType.apiCall,
                    managed: 'true',
                },
            });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to aggregate tokens', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate tokens',
                data: [serializeError(e)],
            });
        }
    }

    /**
     * Given a window use it as is, given none close the period behind now.
     */
    public static resolveAggregationWindow({
        startDate,
        endDate,
    }: {
        startDate?: string | Date;
        endDate?: string | Date;
    } = {}): { startDate: Date; endDate: Date } {
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate
            ? new Date(startDate)
            : new Date(end.getTime() - TokenConsumerService.aggregationWindowInMs);
        return { startDate: start, endDate: end };
    }

    public static sumAggregateResponse(aggregateRes: Array<{ _value?: string | number | boolean }>): number {
        if (!aggregateRes?.length) {
            return 0;
        }
        const total = aggregateRes.reduce((acc, row) => {
            const value = typeof row?._value === 'number' ? row._value : parseFloat(`${row?._value}`);
            return Number.isFinite(value) ? acc + value : acc;
        }, 0);
        // Remove the floating point noise which summing many small amounts introduces.
        return total ? parseFloat(total.toPrecision(12)) : 0;
    }

    /**
     * Resolves meteringco's own account, and the dimension api traffic is metered on, for a meteringco customer.
     */
    public static getMeteringCoAccount(saasCustomerAssociatedBusinessID: string): MeteringCoAccount {
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
     * Schedules the job which closes a metering period, every six hours.
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
    async removeTokenProcessor({ businessID }: { businessID: string }): Promise<BasicResponseDTO | void> {
        try {
            TokenConsumerService.logger.debug(`Removing token processor for businessID: ${businessID}`);
            await this.schedulerService.remove({
                businessID,
                schedulerID: TokenConsumerAsyncProcessor.schedulerIdGenerator(businessID),
            });
            try {
                await this.schedulerService.remove({
                    businessID,
                    schedulerID: TokenConsumerAsyncProcessor.aggregationSchedulerIdGenerator(businessID),
                });
            } catch (e) {
                TokenConsumerService.logger.warn(
                    `No token aggregator schedule found for businessID: ${businessID}`,
                    serializeError(e),
                );
            }
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
