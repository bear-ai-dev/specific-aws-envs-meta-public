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
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { TokenConsumer } from './entities/token-consumer.entity';
import { UsageEntity } from '../usage/entities/usage.entity';
import { TokenType } from './dto/TokenType';
import { MeteringCoTokenMetadata } from './dto/MeteringCoTokenMetadata';
import { createHash } from 'crypto';

export const SIX_HOURS_IN_MS = 216e5;

/**
 * MeteringCo meters its own API traffic against itself. Every registered call is
 * recorded against the meteringco customer which represents the tenant, and every
 * closed period is billed against meteringco's own account (production or sandbox).
 */
export type MeteringCoAccount = {
    /** The meteringco businessID (account) which owns the meteringco customer */
    businessID: string;
    /** The dimension which meteringco's api call usage is metered against for that account */
    dimensionId: string;
};

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);
    /** The amount of tokens a single API call is worth */
    public static apiCallTokenAmount = '0.001';
    /** MeteringCo's own production account and the dimension its api calls are metered on */
    public static meteringcoProductionAccount: MeteringCoAccount = {
        businessID: 'meteringco-production',
        dimensionId: '697f07d0-3180-4351-bdff-7ca029e6c18d',
    };
    /** MeteringCo's own sandbox account and the dimension its api calls are metered on */
    public static meteringcoSandboxAccount: MeteringCoAccount = {
        businessID: 'meteringco-sandbox',
        dimensionId: '00abdf4f-f975-41c6-8293-76ba09a5cb23',
    };
    private static influxServiceSingleton: InfluxService;
    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Optional() @Inject(forwardRef(() => InfluxService)) readonly influxService?: InfluxService,
    ) {}

    /**
     * The influx service to talk to. Falls back to the environment service's client, and
     * finally to a lazily created client so that the static (DI-less) entry points work.
     */
    public static resolveInfluxService(influxService?: InfluxService): InfluxService {
        if (influxService) {
            return influxService;
        }
        if (!TokenConsumerService.influxServiceSingleton) {
            TokenConsumerService.influxServiceSingleton = new InfluxService();
        }
        return TokenConsumerService.influxServiceSingleton;
    }

    private resolvedInfluxService(): InfluxService {
        return TokenConsumerService.resolveInfluxService(
            this.influxService ? this.influxService : this.environmentSerivce?.InfluxService,
        );
    }

    /**
     * Resolves meteringco's own account (and the dimension api calls are metered on) for the
     * meteringco customer which represents the tenant. Production customers are billed against
     * the production account and dimension, everything else against the sandbox pair.
     */
    public static meteringcoAccountForCustomer(
        meteringcoCustomerBusinessID?: string,
        meteringcoCustomer?: ReadCustomerResponseData,
    ): MeteringCoAccount {
        const productionBusinessID = TokenConsumerService.meteringcoProductionAccount.businessID;
        if (meteringcoCustomerBusinessID === productionBusinessID || meteringcoCustomer?.businessID === productionBusinessID) {
            return TokenConsumerService.meteringcoProductionAccount;
        }
        return TokenConsumerService.meteringcoSandboxAccount;
    }

    /**
     * The six hour period a moment belongs to. Periods are aligned to the six hour
     * boundaries of the day so a period is always closed exactly once.
     */
    public static periodForDate(date: Date | string | number = new Date()): { startDate: Date; endDate: Date } {
        const time = new Date(date).getTime();
        const endTime = Math.floor(time / SIX_HOURS_IN_MS) * SIX_HOURS_IN_MS;
        return { startDate: new Date(endTime - SIX_HOURS_IN_MS), endDate: new Date(endTime) };
    }

    /**
     * The window a period close covers. A window which was handed to the job is closed as
     * given, otherwise the aligned six hours behind now is closed.
     */
    public static periodForWindow({
        startDate,
        endDate,
    }: {
        startDate?: string | number | Date;
        endDate?: string | number | Date;
    } = {}): { startDate: Date; endDate: Date } {
        if (startDate && endDate) {
            return { startDate: new Date(startDate), endDate: new Date(endDate) };
        }
        if (startDate) {
            const start = new Date(startDate);
            return { startDate: start, endDate: new Date(start.getTime() + SIX_HOURS_IN_MS) };
        }
        if (endDate) {
            const end = new Date(endDate);
            return { startDate: new Date(end.getTime() - SIX_HOURS_IN_MS), endDate: end };
        }
        return TokenConsumerService.periodForDate(new Date());
    }

    /**
     * Registers a single API call against meteringco's own customer for the tenant which made it.
     * The call is recorded in the token aggregate bucket at its own moment, so a late
     * delivery lands in the period it happened in, and a duplicate delivery of the same
     * call overwrites itself instead of being counted twice.
     *
     * The write is buffered, registering a call never adds a round trip to the request
     * it describes.
     */
    public static async registerToken(
        meteringcoToken: MeteringCoToken,
        influxService?: InfluxService,
        environmentSerivce?: EnvironmentService,
    ): Promise<BasicResponseDTO | void> {
        try {
            const token = new MeteringCoToken(meteringcoToken);
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token?.subject,
                environmentSerivce,
            );
            if (!res) {
                TokenConsumerService.logger.warn(
                    `No customer found for businessID: ${token?.businessID}, cannot register token`,
                );
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = res;
            const { businessID, dimensionId } = TokenConsumerService.meteringcoAccountForCustomer(
                saasCustomerAssociatedBusinessID,
                meteringcoCustomer,
            );
            const influx = TokenConsumerService.resolveInfluxService(influxService);
            const point = MeasurementFormat.getPointForm(
                {
                    _measurement: TokenConsumer._measurement,
                    businessID,
                    customerId: meteringcoCustomerId,
                    dimensionId,
                    recordValue: parseFloat(token.tokenAmount),
                    timestamp: token.timestamp,
                    metadata: token?.metadata,
                },
                influx,
            );
            TokenConsumerService.logger.debug(
                `Registering token for meteringco customerId: ${meteringcoCustomerId}, businessID: ${businessID}, amount: ${token.tokenAmount}, timestamp: ${token.timestamp}`,
            );
            // Buffered write, no flush, registering a call must not add a round trip to it
            await influx.loadPoints(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
                [point],
                false,
            );
            // Drain the buffer without making the caller wait on it
            TokenConsumerService.drainRegisteredTokens(influx);
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

    /**
     * Drains the buffered token registrations, the caller is never made to wait on it.
     */
    public static drainRegisteredTokens(influxService?: InfluxService): void {
        try {
            if (typeof influxService?.flushPendingWrites === 'function') {
                const pending = influxService.flushPendingWrites(TokenConsumerAsyncProcessor.tokenAggregateBucket);
                if (typeof pending?.catch === 'function') {
                    pending.catch((e) =>
                        TokenConsumerService.logger.warn(`Failed to flush registered tokens: ${e?.message}`),
                    );
                }
            }
        } catch (e) {
            TokenConsumerService.logger.warn(`Failed to flush registered tokens: ${e?.message}`);
        }
    }

    /**
     * Registers a single API call, see TokenConsumerService.registerToken
     */
    async registerToken(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerToken(meteringcoToken, this.resolvedInfluxService(), this.environmentSerivce);
    }
    /** Alias of registerToken */
    async register(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.registerToken(meteringcoToken);
    }
    /** Registers one API call for the given tenant */
    async registerApiCall(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.registerToken({
            ...meteringcoToken,
            tokenAmount: meteringcoToken?.tokenAmount ? meteringcoToken.tokenAmount : TokenConsumerService.apiCallTokenAmount,
            metadata: { tokenType: TokenType.apiCall, ...meteringcoToken?.metadata } as MeteringCoTokenMetadata,
        });
    }
    /** Registers one API call for the given tenant, without needing an injected service */
    public static async registerApiCall(
        meteringcoToken: MeteringCoToken,
        influxService?: InfluxService,
        environmentSerivce?: EnvironmentService,
    ): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerToken(
            {
                ...meteringcoToken,
                tokenAmount: meteringcoToken?.tokenAmount ? meteringcoToken.tokenAmount : TokenConsumerService.apiCallTokenAmount,
                metadata: { tokenType: TokenType.apiCall, ...meteringcoToken?.metadata } as MeteringCoTokenMetadata,
            },
            influxService,
            environmentSerivce,
        );
    }

    /**
     * Closes a period for a single meteringco customer. Everything which was registered inside
     * the window is totaled into a single token for the period and that token is turned
     * into billable usage. When no window is given the six hours behind now is closed.
     */
    async aggregateTokens({
        businessID,
        subject,
        startDate,
        endDate,
    }: {
        businessID: string;
        subject?: string;
        startDate?: string | number | Date;
        endDate?: string | number | Date;
    }): Promise<BasicResponseDTO | void> {
        try {
            const period = TokenConsumerService.periodForWindow({ startDate, endDate });
            TokenConsumerService.logger.log(
                `Aggregating registered tokens for businessID: ${businessID} between ${period.startDate.toISOString()} and ${period.endDate.toISOString()}`,
            );
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.error(`No customer found for businessID: ${businessID}`);
                return;
            }
            const { meteringcoCustomerId } = res;
            const influx = this.resolvedInfluxService();
            // Registered calls are buffered, make sure they are readable before totaling them
            if (typeof influx?.flushPendingWrites === 'function') {
                await influx.flushPendingWrites(TokenConsumerAsyncProcessor.tokenAggregateBucket);
            }
            const rows = await influx.aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: period.startDate,
                endDate: period.endDate,
            });
            const total = TokenConsumerService.sumAggregateRows(rows);
            TokenConsumerService.logger.log(
                `Total registered tokens for meteringco customerId: ${meteringcoCustomerId} in period: ${total}`,
            );
            if (!total) {
                return { message: `No tokens registered for businessID: ${businessID} in period` };
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
            return { message: `Aggregated tokens for businessID: ${businessID}` };
        } catch (e) {
            TokenConsumerService.logger.error('Failed to aggregate Tokens', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate Tokens',
                data: [serializeError(e)],
            });
        }
    }
    /** Alias of aggregateTokens */
    async aggregate(input: {
        businessID: string;
        subject?: string;
        startDate?: string | number | Date;
        endDate?: string | number | Date;
    }): Promise<BasicResponseDTO | void> {
        return this.aggregateTokens(input);
    }
    /** Alias of aggregateTokens */
    async aggregateMeteringCoTokens(input: {
        businessID: string;
        subject?: string;
        startDate?: string | number | Date;
        endDate?: string | number | Date;
    }): Promise<BasicResponseDTO | void> {
        return this.aggregateTokens(input);
    }

    /**
     * A stable identity for a call. Delivery of API traffic is at-least-once, the identity
     * is recorded alongside the call so the same call handed over twice, whether a flush or
     * an entire period apart, records itself once instead of twice.
     */
    public static callIdentity(input: Record<string, unknown> | string): string {
        const serialized =
            typeof input === 'string'
                ? input
                : JSON.stringify(
                      Object.keys(input ? input : {})
                          .sort()
                          .reduce((acc, key) => {
                              const value = input[key];
                              if (value !== undefined && typeof value !== 'function') {
                                  acc[key] = value instanceof Date ? value.toISOString() : value;
                              }
                              return acc;
                          }, {}),
                  );
        return createHash('sha1').update(serialized).digest('hex');
    }

    /**
     * Totals the rows returned by the token aggregation query, floats are normalized so
     * the total of a period isn't polluted by floating point drift.
     */
    public static sumAggregateRows(rows: Array<{ _value?: number | string | boolean }> = []): number {
        if (!rows?.length) {
            return 0;
        }
        const total = rows.reduce((acc: number, row) => {
            const value = typeof row?._value === 'number' ? row._value : parseFloat(`${row?._value}`);
            return Number.isFinite(value) ? acc + value : acc;
        }, 0);
        if (!Number.isFinite(total) || total === 0) {
            return 0;
        }
        return parseFloat(total.toPrecision(12));
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
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = res;
                TokenConsumerService.logger.debug(`Metering Token for meteringco customerId: ${meteringcoCustomerId}`);
                const token = new MeteringCoToken(meteringcoToken);
                const { businessID, dimensionId } = TokenConsumerService.meteringcoAccountForCustomer(
                    saasCustomerAssociatedBusinessID,
                    meteringcoCustomer,
                );
                const recordValue = parseFloat(token.tokenAmount);
                if (!Number.isFinite(recordValue)) {
                    throw new BadRequestException(
                        `Invalid token amount: ${token?.tokenAmount} for businessID: ${meteringcoToken?.businessID}`,
                    );
                }
                const influx = this.resolvedInfluxService();
                // The token becomes billable usage against meteringco's own account and dimension
                const point = MeasurementFormat.getPointForm(
                    {
                        _measurement: UsageEntity._measurement,
                        businessID,
                        customerId: meteringcoCustomerId,
                        dimensionId,
                        recordValue,
                        timestamp: token.timestamp,
                        metadata: token?.metadata,
                    },
                    influx,
                );
                await influx.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
                TokenConsumerService.logger.debug(
                    `Metered ${recordValue} tokens as usage for meteringco customerId: ${meteringcoCustomerId}, businessID: ${businessID}, dimensionId: ${dimensionId}`,
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
            // Close the platform's own api traffic every six hours
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
            try {
                await this.schedulerService.remove({
                    businessID,
                    schedulerID: TokenConsumerAsyncProcessor.aggregationSchedulerIdGenerator(businessID),
                });
            } catch (e) {
                TokenConsumerService.logger.warn(
                    `Failed to remove token aggregation processor for businessID: ${businessID}`,
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
