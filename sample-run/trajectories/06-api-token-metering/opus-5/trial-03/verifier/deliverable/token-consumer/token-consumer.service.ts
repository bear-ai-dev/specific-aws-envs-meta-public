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
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { UsageEntity } from '../usage/entities/usage.entity';
import { TokenType } from './dto/TokenType';

export const SIX_HOURS_IN_MS = 216e5;

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);

    /**
     * MeteringCo meters itself. Every customer of the platform lives either in the production
     * meteringco account, or in the sandbox meteringco account, and the api call traffic of that
     * customer is billed against the dimension of the account the customer belongs to.
     */
    public static meteringcoProductionBusinessID = 'meteringco-production';
    public static meteringcoSandboxBusinessID = 'meteringco-sandbox';
    public static meteringcoProductionDimensionId =
        process.env.METERINGCO_PRODUCTION_API_CALL_DIMENSION_ID || '697f07d0-3180-4351-bdff-7ca029e6c18d';
    public static meteringcoSandboxDimensionId =
        process.env.METERINGCO_SANDBOX_API_CALL_DIMENSION_ID || '00abdf4f-f975-41c6-8293-76ba09a5cb23';
    /** The amount of the platform's own product a single api call consumes */
    public static apiCallTokenAmount = process.env.METERINGCO_API_CALL_TOKEN_AMOUNT || '0.001';
    /**
     * Registered tokens are buffered so that recording one does not add a round trip to
     * the request which is being metered. The buffer is handed over to the database on
     * this cadence.
     */
    public static tokenFlushIntervalInMs = Number(process.env.METERINGCO_TOKEN_FLUSH_INTERVAL_MS || 1000);
    private static flushTimeout: ReturnType<typeof setTimeout> | undefined;
    private static pendingFlushes = new Set<InfluxService>();

    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
    ) {}

    /**
     * Given the meteringco account a platform customer belongs to, resolve the account and the
     * dimension the customer's usage of the platform is billed against.
     */
    public static meteringcoAccountForCustomer(saasCustomerAssociatedBusinessID: string): {
        businessID: string;
        dimensionId: string;
    } {
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
     * Floating point sums of many very small token amounts carry noise, keep the amount
     * which reaches an invoice readable.
     */
    public static roundTokenAmount(amount: number): string {
        return parseFloat(amount.toFixed(6)).toString();
    }

    /**
     * Records a single api call against the platform's own customer for the tenant which
     * made it.
     *
     * The record is written into the token aggregate bucket at the moment the call
     * happened, and the write is buffered: metering an api call must not add a round trip
     * to the request it describes.
     */
    public static async registerToken({
        meteringcoToken,
        influxService,
        environmentService,
    }: {
        meteringcoToken: MeteringCoToken;
        influxService: InfluxService;
        environmentService?: EnvironmentService;
    }): Promise<void> {
        try {
            const token = new MeteringCoToken(meteringcoToken);
            if (!token?.businessID && !token?.subject) {
                return;
            }
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                token.businessID,
                token?.subject,
                environmentService,
            );
            if (!res) {
                TokenConsumerService.logger.debug(
                    `No meteringco customer found for businessID: ${token?.businessID}, api call was not registered`,
                );
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.meteringcoAccountForCustomer(
                saasCustomerAssociatedBusinessID,
            );
            const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, meteringcoBusinessID, dimensionId);
            const points = TokenConsumer.transformer(tokenConsumer, influxService);
            TokenConsumerService.logger.debug(
                `Registering ${token?.metadata?.tokenType} token for meteringco customerId: ${meteringcoCustomerId} at ${token.timestamp}`,
            );
            // flush: false, the point is buffered, the request being metered pays nothing for it
            await influxService.loadPoints(
                TokenConsumerAsyncProcessor.tokenAggregateBucket,
                process.env.INFLUX_ORG,
                points,
                false,
            );
            TokenConsumerService.scheduleTokenFlush(influxService);
        } catch (e) {
            TokenConsumerService.logger.error('Failed to register api call token', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to register api call token',
                data: [serializeError(e)],
            });
        }
    }

    /**
     * Hands the buffered tokens over to the database. Many api calls share a single write.
     */
    public static scheduleTokenFlush(influxService: InfluxService): void {
        TokenConsumerService.pendingFlushes.add(influxService);
        if (TokenConsumerService.flushTimeout) {
            return;
        }
        TokenConsumerService.flushTimeout = setTimeout(async () => {
            TokenConsumerService.flushTimeout = undefined;
            const pending = [...TokenConsumerService.pendingFlushes];
            TokenConsumerService.pendingFlushes.clear();
            await Promise.all(
                pending.map((service) => service.flushPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket)),
            );
        }, TokenConsumerService.tokenFlushIntervalInMs);
        if (typeof TokenConsumerService.flushTimeout?.unref === 'function') {
            TokenConsumerService.flushTimeout.unref();
        }
    }

    /**
     * Instance flavour of {@link TokenConsumerService.registerToken}
     */
    async register(meteringcoToken: MeteringCoToken): Promise<void> {
        return TokenConsumerService.registerToken({
            meteringcoToken,
            influxService: this.influxService,
            environmentService: this.environmentSerivce,
        });
    }

    /**
     * Closes a period: totals the registered api call traffic of a single platform
     * customer across the given window, and turns that total into a single token for the
     * period. When no window is given the six hours behind now are closed.
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
            const start = startDate ? new Date(startDate) : new Date(end.getTime() - SIX_HOURS_IN_MS);
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.error(`No customer found for businessID: ${businessID}`);
                return;
            }
            const { meteringcoCustomerId } = res;
            TokenConsumerService.logger.debug(
                `Aggregating meteringco tokens for customerId: ${meteringcoCustomerId} between ${start.toISOString()} and ${end.toISOString()}`,
            );
            const rows = await this.influxService.aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: start,
                endDate: end,
            });
            const total = (rows || []).reduce((acc, row) => acc + (Number(row?._value) || 0), 0);
            if (!total) {
                TokenConsumerService.logger.debug(
                    `No token usage found for customerId: ${meteringcoCustomerId} between ${start.toISOString()} and ${end.toISOString()}`,
                );
                return { message: `No token usage found for businessID: ${businessID}` };
            }
            return this.create({
                businessID,
                subject,
                tokenAmount: TokenConsumerService.roundTokenAmount(total),
                timestamp: end.toISOString(),
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

    /**
     * Turns a token into billable usage against the platform's own account.
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
                const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.meteringcoAccountForCustomer(
                    saasCustomerAssociatedBusinessID,
                );
                const entity = new StandardMeasurementEntity({
                    _measurement: UsageEntity._measurement,
                    businessID: meteringcoBusinessID,
                    customerId: meteringcoCustomerId,
                    dimensionId,
                    recordValue: parseFloat(token.tokenAmount),
                    timestamp: token.timestamp,
                    metadata: token?.metadata,
                });
                const point = MeasurementFormat.getPointForm(entity, this.influxService);
                await this.influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
                TokenConsumerService.logger.debug(
                    `Metered ${token.tokenAmount} ${token?.metadata?.tokenType} tokens against ${meteringcoBusinessID} dimension: ${dimensionId} for customerId: ${meteringcoCustomerId}`,
                );
                return { message: `Token Consumer created for businessID: ${token?.businessID}` };
            } else {
                TokenConsumerService.logger.error(`No customer found for businessID: ${token?.businessID}`);
                throw new BadRequestException(`No customer found for businessID: ${token?.businessID}`);
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
     * The registered api call traffic is closed out, and billed, every six hours.
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
