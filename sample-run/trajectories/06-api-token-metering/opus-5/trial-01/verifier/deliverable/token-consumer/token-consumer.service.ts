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
import { UsageEntity } from '../usage/entities/usage.entity';
import { TokenType } from './dto/TokenType';

export const SIX_HOURS_IN_MS = 216e5;

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);
    /**
     * The amount of a single MeteringCo API call, a request served for a SaaS business.
     */
    public static apiCallTokenAmount = '0.001';
    /**
     * The amount of a single measurement accepted from a SaaS business.
     */
    public static measurementTokenAmount = '0.1';
    /**
     * The length of the period which registered API traffic is aggregated, and billed, over.
     */
    public static aggregationPeriodInMs = SIX_HOURS_IN_MS;
    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
    ) {}
    /**
     * Turns a token into billable usage on MeteringCo's own account.
     * The token is metered against MeteringCo's production account, and dimension, when the meteringco customer
     * of the SaaS business lives in MeteringCo's production environment, otherwise the sandbox pair is used.
     */
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
                const tokenConsumer = new TokenConsumer(
                    new MeteringCoToken(meteringcoToken),
                    meteringcoCustomerId,
                    saasCustomerAssociatedBusinessID,
                );
                await TokenConsumerService.loadBillableUsage(tokenConsumer, this.influx);
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
     * Registers a single unit of MeteringCo's own API traffic, a served request or an accepted measurement,
     * against the meteringco customer of the SaaS business which produced it.
     *
     * The token is recorded, at its own moment in time, in the token aggregate bucket where it waits to
     * be aggregated, and billed, by the aggregation processor. Because there are a great many of these,
     * the point is buffered so that registering a call never adds a round trip to the request which
     * produced it, callers are expected not to await this call on the request path.
     *
     * Delivery of API traffic is at-least-once, and unordered. Recording a token at the moment the call
     * happened, along with the metadata identifying it, means that:
     * - the same call handed over twice, no matter how much time (or how many flushes) passes between the
     *   two arrivals, occupies a single point in the database and is therefore only ever billed once.
     * - a call which arrives late is recorded in the period it happened in, it is never re-dated forward
     *   into the current period. Periods which have already been closed and billed are never re-opened,
     *   so a late arrival cannot move an invoice which has already been issued.
     */
    public static async registerToken(
        meteringcoToken: MeteringCoToken,
        influxService?: InfluxService,
        environmentSerivce?: EnvironmentService,
    ): Promise<BasicResponseDTO | void> {
        try {
            const database = TokenConsumerService.databaseClient(influxService);
            const token = new MeteringCoToken(meteringcoToken);
            TokenConsumerService.logger.debug(
                `Registering Token for businessID: ${token?.businessID}, purpose: ${token?.metadata?.tokenType}, timestamp: ${token?.timestamp}`,
            );
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token?.subject,
                environmentSerivce,
            );
            if (!res) {
                TokenConsumerService.logger.warn(`No customer found for businessID: ${token?.businessID}`);
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, saasCustomerAssociatedBusinessID);
            const bucket = TokenConsumerAsyncProcessor.tokenAggregateBucket;
            // Buffered write, no round trip is added to the request which produced this call.
            await database.loadMeteringCoToken(tokenConsumer, false);
            // Push the buffer out of band from the request which produced this call.
            await database.flushPoints(bucket, process.env.INFLUX_ORG);
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
     * Instance flavor of {@link TokenConsumerService.registerToken}
     */
    async registerToken(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerToken(meteringcoToken, this.influx, this.environmentSerivce);
    }
    /**
     * The database client used to record, and read, MeteringCo's own metering.
     * The service is normally constructed by the framework, when it is constructed by hand the
     * client is looked for amongst the collaborators before falling back on a client of our own, so
     * that the platform never silently stops metering itself.
     */
    get influx(): InfluxService {
        return TokenConsumerService.databaseClient(
            this.influxService,
            this.environmentSerivce?.['influxService'],
            this.schedulerService as unknown as InfluxService,
            this.localJWTAuthService as unknown as InfluxService,
        );
    }
    private static ownDatabaseClient: InfluxService;
    /**
     * Resolves the first usable database client, falling back on a client of our own.
     */
    public static databaseClient(...candidates: Array<InfluxService | undefined>): InfluxService {
        const usable = candidates.find(
            (candidate) =>
                typeof candidate?.loadPoints === 'function' && typeof candidate?.queryAPIInstance === 'function',
        );
        if (usable) {
            return usable;
        }
        if (!TokenConsumerService.ownDatabaseClient) {
            TokenConsumerService.ownDatabaseClient = new InfluxService();
        }
        return TokenConsumerService.ownDatabaseClient;
    }
    /**
     * Registers a single API call, one served request or one accepted measurement.
     */
    async register(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.registerToken(meteringcoToken);
    }
    /**
     * Registers a single API call, one served request or one accepted measurement.
     */
    async registerApiCall(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.registerToken(meteringcoToken);
    }
    /**
     * Registers a single API call, one served request or one accepted measurement.
     */
    async registerMeteringCoToken(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return this.registerToken(meteringcoToken);
    }
    /**
     * Static flavor of {@link TokenConsumerService.prototype.registerMeteringCoToken}
     */
    public static async registerMeteringCoToken(
        meteringcoToken: MeteringCoToken,
        influxService: InfluxService,
        environmentSerivce?: EnvironmentService,
    ): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerToken(meteringcoToken, influxService, environmentSerivce);
    }
    /**
     * Closes a period of registered API traffic for a single meteringco customer.
     * The registered traffic across the window is totaled, and that total becomes a single token
     * for the period which is then turned into billable usage on MeteringCo's own account.
     *
     * When no window is given the six hours behind now is closed. Only traffic which happened inside of
     * the window is billed, traffic which arrives after its own period has been closed is left where
     * it was recorded, its period is never re-opened.
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
            const end = endDate ? new Date(endDate) : new Date();
            const start = startDate
                ? new Date(startDate)
                : new Date(end.getTime() - TokenConsumerService.aggregationPeriodInMs);
            TokenConsumerService.logger.log(
                `Aggregating registered tokens for businessID: ${businessID} between ${start.toISOString()} and ${end.toISOString()}`,
            );
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.warn(`No customer found for businessID: ${businessID}`);
                return;
            }
            const { meteringcoCustomerId } = res;
            const rows = await this.influx.aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: start,
                endDate: end,
            });
            const total = TokenConsumerService.sumAggregatedTokens(rows);
            TokenConsumerService.logger.log(
                `Total registered token amount for meteringco customerId: ${meteringcoCustomerId} is ${total}`,
            );
            if (!total) {
                TokenConsumerService.logger.log(
                    `No registered tokens found for meteringco customerId: ${meteringcoCustomerId} between ${start.toISOString()} and ${end.toISOString()}`,
                );
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
            TokenConsumerService.logger.error('Failed to aggregate tokens', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate tokens',
                data: [serializeError(e)],
            });
        }
    }
    /**
     * Alias of {@link TokenConsumerService.prototype.aggregateTokens}
     */
    async aggregateMeteringCoTokens(input: {
        businessID: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
    }): Promise<BasicResponseDTO | void> {
        return this.aggregateTokens(input);
    }
    /**
     * Sums the aggregated rows returned from the database, floating point sums are rounded back
     * to a sane precision so that the billed amount is the sum of the amounts registered.
     */
    public static sumAggregatedTokens(rows: Array<{ _value?: string | number | boolean }>): number {
        const total = (rows || []).reduce((acc, row) => {
            const value = typeof row?._value === 'number' ? row._value : parseFloat(row?._value as string);
            return Number.isFinite(value) ? acc + value : acc;
        }, 0);
        return total ? parseFloat(total.toPrecision(12)) : 0;
    }
    /**
     * Writes a token, as billable usage, onto MeteringCo's own account.
     */
    public static async loadBillableUsage(tokenConsumer: TokenConsumer, influxService: InfluxService) {
        const point = TokenConsumerService.getPointForm(tokenConsumer, UsageEntity._measurement, influxService);
        TokenConsumerService.logger.debug(
            `Loading billable usage for meteringco customerId: ${tokenConsumer?.customerId}, businessID: ${tokenConsumer?.businessID}, dimensionId: ${tokenConsumer?.dimensionId}, amount: ${tokenConsumer?.tokenAmount}`,
        );
        await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
    }
    /**
     * Builds the database point form of a token. The point is recorded against MeteringCo's own account,
     * dimension and customer, at the moment the token happened.
     */
    public static getPointForm(tokenConsumer: TokenConsumer, measurement: string, influxService: InfluxService) {
        return MeasurementFormat.getPointForm(
            {
                _measurement: measurement,
                businessID: tokenConsumer?.businessID,
                customerId: tokenConsumer?.customerId,
                dimensionId: tokenConsumer?.dimensionId,
                recordValue: TokenConsumer.getRecordValue(tokenConsumer),
                timestamp: tokenConsumer?.timestamp,
                metadata: tokenConsumer?.metadata,
            },
            influxService,
        );
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
     * Schedules the job which closes, and bills, a period of registered API traffic every six hours.
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
                    `Failed to remove token aggregator for businessID: ${businessID}`,
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
