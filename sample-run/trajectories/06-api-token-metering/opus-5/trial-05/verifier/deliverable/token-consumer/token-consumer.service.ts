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
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { UsageEntity } from '../usage/entities/usage.entity';
import { BaseInfluxTable } from '../influx/entities/baseInfluxTable.entity';

const SIX_HOURS_IN_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);

    /** The meteringco (dogfood) accounts the platform meters itself against */
    public static meteringcoProductionBusinessID = 'meteringco-production';
    public static meteringcoSandboxBusinessID = 'meteringco-sandbox';
    /** The dimension api call usage is metered against on each meteringco account */
    public static meteringcoProductionApiCallDimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
    public static meteringcoSandboxApiCallDimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
    /** Amount of a single served api call */
    public static apiCallTokenAmount = '0.001';
    /** Amount of a single accepted measurement */
    public static measurementTokenAmount = '0.1';
    /** The size of the period which is closed and billed by the aggregation processor */
    public static aggregationWindowInMs = SIX_HOURS_IN_MS;

    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
    ) {}

    /**
     * Turns a token into billable usage against meteringco's own account.
     *
     * The usage is written for the meteringco customer which represents the calling business, on the
     * production account and dimension when that customer lives in production, on the sandbox pair
     * otherwise. The usage keeps the timestamp of the token, so a token for an already closed period
     * is never re-dated into the current one.
     */
    async create(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO> {
        try {
            const token = new MeteringCoToken(meteringcoToken);
            TokenConsumerService.logger.debug(
                `Metering Token for businessID: ${token?.businessID}, purpose: ${token?.metadata?.tokenType}`,
            );
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token?.subject,
                this.environmentSerivce,
            );
            if (res) {
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
                TokenConsumerService.logger.debug(`Metering Token for meteringco customerId: ${meteringcoCustomerId}`);
                const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.getMeteringCoAccount(
                    saasCustomerAssociatedBusinessID,
                );
                const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, saasCustomerAssociatedBusinessID);
                const usageMeasurement = TokenConsumer.toMeasurementFormat(tokenConsumer, {
                    businessID: meteringcoBusinessID,
                    dimensionId,
                    measurement: UsageEntity._measurement,
                });
                const measurementEntity = new StandardMeasurementEntity(usageMeasurement);
                // Publish the usage so every standard measurement subscriber picks it up
                StandardMeasurementEntity.publish(measurementEntity);
                const influxService = TokenConsumerService.getInfluxService(this.environmentSerivce);
                if (influxService) {
                    // Writing the same measurement is idempotent, its identified by its series and its timestamp
                    await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [
                        MeasurementFormat.getPointForm(measurementEntity, influxService),
                    ]);
                }
                TokenConsumerService.logger.debug(
                    `Metered ${token?.tokenAmount} of ${token?.metadata?.tokenType} usage for meteringco customerId: ${meteringcoCustomerId} on businessID: ${meteringcoBusinessID} and dimensionId: ${dimensionId}`,
                );
                return { message: `Token Consumer created for businessID: ${token?.businessID}` };
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
     * Registers a single api call against the meteringco customer of the calling business.
     *
     * The call is recorded in the token aggregate bucket at the moment the call happened, never at
     * the moment it was handed to us. Recording is buffered, no network round trip is added to the
     * request being metered, and writing the very same call twice is a no-op since the point is
     * identified by its series and its own timestamp.
     */
    public static async registerToken(
        meteringcoToken: MeteringCoToken,
        environmentService?: EnvironmentService,
        influxService?: InfluxService,
    ): Promise<TokenConsumer | void> {
        try {
            const token = new MeteringCoToken({
                ...meteringcoToken,
                tokenAmount: meteringcoToken?.tokenAmount ? meteringcoToken.tokenAmount : TokenConsumerService.apiCallTokenAmount,
                metadata: { tokenType: TokenType.apiCall, ...meteringcoToken?.metadata },
            });
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token?.subject,
                environmentService,
            );
            if (!res) {
                TokenConsumerService.logger.warn(
                    `No meteringco customer found for businessID: ${token?.businessID}, cannot register api call`,
                );
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.getMeteringCoAccount(
                saasCustomerAssociatedBusinessID,
            );
            const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, saasCustomerAssociatedBusinessID);
            const influx = TokenConsumerService.getInfluxService(environmentService, influxService);
            const points = TokenConsumer.transformer(tokenConsumer, influx, {
                businessID: meteringcoBusinessID,
                dimensionId,
            });
            // Recorded without a round trip, the points are batched and shipped in the background
            await influx.loadPoints(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
                points,
                false,
            );
            TokenConsumerService.logger.debug(
                `Registered ${token?.tokenAmount} ${token?.metadata?.tokenType} token for meteringco customerId: ${meteringcoCustomerId} at ${tokenConsumer?.timestamp}`,
            );
            return tokenConsumer;
        } catch (e) {
            TokenConsumerService.logger.error('Failed to register token', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to register token',
                data: [serializeError(e)],
            });
        }
    }

    /** Alias of `registerToken` */
    public static async registerAPICall(
        meteringcoToken: MeteringCoToken,
        environmentService?: EnvironmentService,
        influxService?: InfluxService,
    ): Promise<TokenConsumer | void> {
        return TokenConsumerService.registerToken(meteringcoToken, environmentService, influxService);
    }

    async registerToken(meteringcoToken: MeteringCoToken): Promise<TokenConsumer | void> {
        return TokenConsumerService.registerToken(meteringcoToken, this.environmentSerivce);
    }

    async registerAPICall(meteringcoToken: MeteringCoToken): Promise<TokenConsumer | void> {
        return TokenConsumerService.registerToken(meteringcoToken, this.environmentSerivce);
    }

    /**
     * Closes a period for a single meteringco customer.
     *
     * Every api call registered inside the window is totalled and that total becomes a single token
     * for the period which is then metered as billable usage. When no window is given the six hours
     * behind now are closed. Calls which land after their period was closed stay recorded at their
     * own moment, they never re-open, nor move, an already billed period.
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
            const window = TokenConsumerService.getAggregationWindow({ startDate, endDate });
            TokenConsumerService.logger.log(
                `Aggregating meteringco tokens for businessID: ${businessID} between ${window.startDate.toISOString()} and ${window.endDate.toISOString()}`,
            );
            let meteringcoCustomerId = customerId;
            if (!meteringcoCustomerId) {
                const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
                if (!res) {
                    TokenConsumerService.logger.warn(
                        `No meteringco customer found for businessID: ${businessID}, cannot aggregate meteringco tokens`,
                    );
                    return;
                }
                meteringcoCustomerId = res.meteringcoCustomerId;
            }
            const influxService = TokenConsumerService.getInfluxService(this.environmentSerivce);
            // Ship anything which is still buffered before closing the period
            await influxService.flushPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, process.env.INFLUX_ORG);
            const rows = await influxService.aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: window.startDate,
                endDate: window.endDate,
            });
            const tokenAmount = TokenConsumerService.sumTokens(rows);
            TokenConsumerService.logger.log(
                `Found ${tokenAmount} meteringco token usage for customerId: ${meteringcoCustomerId} between ${window.startDate.toISOString()} and ${window.endDate.toISOString()}`,
            );
            if (!tokenAmount) {
                return {
                    message: `No meteringco tokens found for businessID: ${businessID} between ${window.startDate.toISOString()} and ${window.endDate.toISOString()}`,
                };
            }
            return await this.create({
                businessID,
                subject,
                tokenAmount: tokenAmount.toString(),
                metadata: {
                    tokenType: TokenType.apiCall,
                    managed: 'true',
                },
            });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to aggregate meteringco tokens', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to aggregate meteringco tokens',
                data: [serializeError(e)],
            });
        }
    }

    /** Alias of `aggregateTokens` */
    async aggregateMeteringCoTokens(input: {
        businessID: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
        customerId?: string;
    }): Promise<BasicResponseDTO | void> {
        return this.aggregateTokens(input);
    }

    /** Alias of `aggregateTokens` */
    async aggregateTokenUsage(input: {
        businessID: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
        customerId?: string;
    }): Promise<BasicResponseDTO | void> {
        return this.aggregateTokens(input);
    }

    /**
     * The period a set of api calls belongs to. When no window is given the six hours behind now
     * are used, aligned on the six hour boundary the aggregation is scheduled on, so periods neither
     * overlap nor leave gaps between two runs.
     */
    public static getAggregationWindow({
        startDate,
        endDate,
        now = new Date(),
    }: {
        startDate?: string | Date;
        endDate?: string | Date;
        now?: Date;
    } = {}): { startDate: Date; endDate: Date } {
        if (startDate && endDate) {
            return { startDate: new Date(startDate), endDate: new Date(endDate) };
        }
        if (startDate && !endDate) {
            const start = new Date(startDate);
            return {
                startDate: start,
                endDate: new Date(start.getTime() + TokenConsumerService.aggregationWindowInMs),
            };
        }
        if (!startDate && endDate) {
            const end = new Date(endDate);
            return { startDate: new Date(end.getTime() - TokenConsumerService.aggregationWindowInMs), endDate: end };
        }
        const end = new Date(
            Math.floor(now.getTime() / TokenConsumerService.aggregationWindowInMs) *
                TokenConsumerService.aggregationWindowInMs,
        );
        return {
            startDate: new Date(end.getTime() - TokenConsumerService.aggregationWindowInMs),
            endDate: end,
        };
    }

    /** The meteringco account and dimension api usage is metered against */
    public static getMeteringCoAccount(saasCustomerAssociatedBusinessID?: string): {
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

    /** Totals the rows returned by `InfluxService.aggregateMeteringCoToken` */
    public static sumTokens(rows: Array<BaseInfluxTable | { _value?: number }>): number {
        if (!rows?.length) {
            return 0;
        }
        const total = rows.reduce((acc, row) => {
            const value = typeof row?._value === 'number' ? row._value : parseFloat(String(row?._value));
            return Number.isFinite(value) ? acc + value : acc;
        }, 0);
        // Remove the floating point noise a sum of many small amounts collects
        return total ? parseFloat(total.toPrecision(12)) : 0;
    }

    private static influxService: InfluxService;
    public static getInfluxService(
        environmentService?: EnvironmentService,
        influxService?: InfluxService,
    ): InfluxService {
        if (influxService) {
            return influxService;
        }
        if (environmentService?.InfluxService) {
            return environmentService.InfluxService;
        }
        if (!TokenConsumerService.influxService) {
            TokenConsumerService.influxService = new InfluxService();
        }
        return TokenConsumerService.influxService;
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

    /** Schedules the job which closes and bills a period of api calls, every six hours */
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

    async findAll({ businessID }: { businessID: string }): Promise<{ access_token: string }> {
        try {
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID);
            if (res) {
                TokenConsumerService.logger.debug(`Finding meteringco token usage for businessID: ${businessID}`);
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;

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
