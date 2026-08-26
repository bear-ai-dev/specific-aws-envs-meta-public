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
import { MeteringCoTokenMetadata } from './dto/MeteringCoTokenMetadata';
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { TokenAsyncAggregatorDto } from './dto/schedulerAsyncProcessor.dto';
import { createHash, randomUUID } from 'crypto';

export const SIX_HOURS_IN_MS = 216e5;

@Injectable()
export class TokenConsumerService {
    public static cacheKey = (businessID) => `${businessID}-tokenConsumer`;
    public static logger = new Logger(TokenConsumerService.name);
    /**
     * MeteringCo's own (dogfood) production account. Every meteringco customer which lives in this account is
     * billed against the production account and its api call dimension.
     */
    public static meteringcoProductionBusinessID = 'meteringco-production';
    /**
     * MeteringCo's own (dogfood) sandbox account. Anything which is not production is billed here.
     */
    public static meteringcoSandboxBusinessID = 'meteringco-sandbox';
    /**
     * The api call dimension of meteringco's own offering in each of meteringco's own accounts.
     */
    public static meteringcoProductionApiCallDimensionId =
        process.env.METERINGCO_PRODUCTION_API_CALL_DIMENSION_ID || '697f07d0-3180-4351-bdff-7ca029e6c18d';
    public static meteringcoSandboxApiCallDimensionId =
        process.env.METERINGCO_SANDBOX_API_CALL_DIMENSION_ID || '00abdf4f-f975-41c6-8293-76ba09a5cb23';
    /**
     * How much of meteringco's own product a single api call consumes.
     */
    public static apiCallTokenAmount = process.env.METERINGCO_API_CALL_TOKEN_AMOUNT || '0.001';
    constructor(
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentSerivce: EnvironmentService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService?: InfluxService,
    ) {}

    /**
     * MeteringCo's own account (and the dimension inside of it) which a given meteringco customer is billed against.
     */
    public static meteringcoBillingAccount(saasCustomerAssociatedBusinessID?: string): {
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
     * The window a scheduled aggregation covers. When no window is handed over, the six hours behind
     * the run are closed.
     */
    public static tokenAggregationWindow({
        startDate,
        endDate,
    }: { startDate?: string | Date; endDate?: string | Date } = {}): { startDate: Date; endDate: Date } {
        const end = endDate ? new Date(endDate) : new Date();
        const start = startDate ? new Date(startDate) : new Date(end.getTime() - SIX_HOURS_IN_MS);
        return { startDate: start, endDate: end };
    }
    /**
     * A stable identity for a metered api call. At least once delivery means the very same call can be
     * handed over more than once, so the identity of a call may never be random when the caller can
     * describe the call itself: identical deliveries land on one single record.
     */
    public static apiCallIdentity(identity?: Record<string, unknown> | string): string {
        if (!identity) {
            return randomUUID();
        }
        if (typeof identity === 'string') {
            return identity;
        }
        const hash = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
        // Shaped like a uuid, but derived from the call itself so repeated deliveries share it.
        return [
            hash.slice(0, 8),
            hash.slice(8, 12),
            `5${hash.slice(13, 16)}`,
            `${((parseInt(hash.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hash.slice(17, 20)}`,
            hash.slice(20, 32),
        ].join('-');
    }
    private static influxInstance(influxService?: InfluxService): InfluxService {
        if (influxService) {
            return influxService;
        }
        if (!TokenConsumerService.defaultInfluxService) {
            TokenConsumerService.defaultInfluxService = new InfluxService();
        }
        return TokenConsumerService.defaultInfluxService;
    }
    private static defaultInfluxService: InfluxService;
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
                await TokenConsumerService.meterBillableUsage(
                    new MeteringCoToken(meteringcoToken),
                    { meteringcoCustomerId, saasCustomerAssociatedBusinessID },
                    this.influxService,
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
     * Turns a token into billable usage against meteringco's own account: the production account and its api
     * call dimension when the meteringco customer lives in production, the sandbox pair otherwise.
     */
    public static async meterBillableUsage(
        meteringcoToken: MeteringCoToken,
        {
            meteringcoCustomerId,
            saasCustomerAssociatedBusinessID,
        }: { meteringcoCustomerId: string; saasCustomerAssociatedBusinessID?: string },
        influxService?: InfluxService,
    ): Promise<MeasurementFormat> {
        const token = new MeteringCoToken(meteringcoToken);
        const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.meteringcoBillingAccount(
            saasCustomerAssociatedBusinessID,
        );
        const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, meteringcoBusinessID, dimensionId);
        const measurement = TokenConsumer.getBillableUsageForm(tokenConsumer);
        TokenConsumerService.logger.debug(
            `Metering ${measurement.recordValue} token(s) as billable usage for meteringco customerId: ${meteringcoCustomerId}, meteringco businessID: ${meteringcoBusinessID}, dimensionId: ${dimensionId}`,
        );
        const influx = TokenConsumerService.influxInstance(influxService);
        const point = MeasurementFormat.getPointForm(measurement, influx);
        await influx.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
        // Let anything else listening on measurements (invoicing, alerting, webhooks...) see it too.
        // The very same point is written, so the record itself can never be counted twice.
        StandardMeasurementEntity.publish(new StandardMeasurementEntity(measurement));
        return measurement;
    }
    /**
     * Registers a single api call against meteringco's own customer for the tenant which made it.
     *
     * The call is written into the token aggregate bucket at the moment the call happened, tagged with
     * the identity it arrived with. Nothing here is ever dated forward: a call which turns up late is
     * still recorded inside the period it belongs to, and a call which is handed over twice lands on
     * the very same record, so it can never be counted twice.
     *
     * The returned promise is deliberately not something a request handler should wait on - metering an
     * api call must never add a round trip to the request it describes.
     */
    async register(meteringcoToken: MeteringCoToken): Promise<BasicResponseDTO | void> {
        return TokenConsumerService.registerToken(meteringcoToken, this.influxService, this.environmentSerivce);
    }
    /**
     * @see TokenConsumerService.register
     */
    public static async registerToken(
        meteringcoToken: MeteringCoToken,
        influxService?: InfluxService,
        environmentSerivce?: EnvironmentService,
        meteringcoCustomer?: { meteringcoCustomerId: string; saasCustomerAssociatedBusinessID: string },
    ): Promise<BasicResponseDTO | void> {
        try {
            const token = new MeteringCoToken(meteringcoToken);
            if (!token?.tokenAmount) {
                token.tokenAmount = TokenConsumerService.apiCallTokenAmount;
            }
            if (!token?.metadata) {
                token.metadata = { tokenType: TokenType.apiCall } as MeteringCoTokenMetadata;
            }
            const resolvedCustomer =
                meteringcoCustomer ||
                (await TokenConsumerService.getMeteringCoCustomerId(token.businessID, token?.subject, environmentSerivce));
            if (!resolvedCustomer) {
                TokenConsumerService.logger.error(
                    `No meteringco customer found for businessID: ${token?.businessID}, unable to register api call`,
                );
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = resolvedCustomer;
            const { businessID: meteringcoBusinessID, dimensionId } = TokenConsumerService.meteringcoBillingAccount(
                saasCustomerAssociatedBusinessID,
            );
            const tokenConsumer = new TokenConsumer(token, meteringcoCustomerId, meteringcoBusinessID, dimensionId);
            const influx = TokenConsumerService.influxInstance(influxService);
            const point = TokenConsumer.getPointForm(tokenConsumer, influx);
            TokenConsumerService.logger.debug(
                `Registering ${token.tokenAmount} token(s) of ${token?.metadata?.tokenType} for meteringco customerId: ${meteringcoCustomerId} at ${token.timestamp}`,
            );
            await influx.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, process.env.INFLUX_ORG, [point]);
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
     * Registers a single api call. Convenience wrapper around {@link register} which fills in the
     * amount and the api call metadata.
     */
    async registerApiCall({
        businessID,
        subject,
        timestamp,
        tokenAmount,
        identity,
        metadata,
    }: {
        businessID: string;
        subject?: string;
        timestamp?: string;
        tokenAmount?: string;
        identity?: Record<string, unknown> | string;
        metadata?: Partial<MeteringCoTokenMetadata>;
    }): Promise<BasicResponseDTO | void> {
        return this.register({
            businessID,
            subject,
            timestamp: timestamp ? timestamp : new Date().toISOString(),
            tokenAmount: tokenAmount ? tokenAmount : TokenConsumerService.apiCallTokenAmount,
            metadata: {
                tokenType: TokenType.apiCall,
                uuid: TokenConsumerService.apiCallIdentity(identity),
                ...metadata,
            } as MeteringCoTokenMetadata,
        });
    }
    /**
     * Closes a metering period for a single meteringco customer.
     *
     * Everything which was registered inside the window is totalled and that total becomes one single
     * token, which in turn becomes billable usage against meteringco's own account. A window which has been
     * closed is never re-opened: whatever turns up for it afterwards is still recorded, but it does not
     * move an invoice which has already been issued.
     */
    async aggregateTokens({
        businessID,
        subject,
        startDate,
        endDate,
        customerId,
        saasCustomerAssociatedBusinessID,
    }: {
        businessID?: string;
        subject?: string;
        startDate?: string | Date;
        endDate?: string | Date;
        customerId?: string;
        saasCustomerAssociatedBusinessID?: string;
    }): Promise<BasicResponseDTO | void> {
        try {
            const window = TokenConsumerService.tokenAggregationWindow({ startDate, endDate });
            TokenConsumerService.logger.debug(
                `Aggregating registered api calls for businessID: ${businessID} between ${window.startDate.toISOString()} and ${window.endDate.toISOString()}`,
            );
            const res = customerId
                ? { meteringcoCustomerId: customerId, saasCustomerAssociatedBusinessID }
                : await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.error(
                    `No meteringco customer found for businessID: ${businessID}, unable to aggregate tokens`,
                );
                return;
            }
            const { meteringcoCustomerId } = res;
            const influxService = TokenConsumerService.influxInstance(this.influxService);
            // Anything registered but still buffered belongs to the period it happened in, flush before totalling.
            if (influxService?.flushWriteApi) {
                await influxService.flushWriteApi(TokenConsumerAsyncProcessor.tokenAggregateBucket);
            }
            const rows = await influxService.aggregateMeteringCoToken({
                customerId: meteringcoCustomerId,
                startDate: window.startDate,
                endDate: window.endDate,
            });
            const total = TokenConsumerService.sumAggregatedTokens(rows);
            TokenConsumerService.logger.debug(
                `Aggregated ${total} token(s) of api calls for meteringco customerId: ${meteringcoCustomerId}`,
            );
            if (!total) {
                return {
                    message: `No api calls registered for ${
                        businessID ? `businessID: ${businessID}` : `meteringco customerId: ${meteringcoCustomerId}`
                    } between ${window.startDate.toISOString()} and ${window.endDate.toISOString()}`,
                };
            }
            const token: MeteringCoToken = {
                businessID,
                subject,
                tokenAmount: total.toString(),
                metadata: {
                    tokenType: TokenType.apiCall,
                    managed: 'true',
                },
            };
            if (businessID) {
                // The total of the period becomes one single token, and that token becomes billable usage.
                return await this.create(token);
            }
            await TokenConsumerService.meterBillableUsage(new MeteringCoToken(token), res, this.influxService);
            return { message: `Token Consumer created for meteringco customerId: ${meteringcoCustomerId}` };
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
     * Totals the rows returned for an aggregation window, without dragging floating point noise into
     * the invoice.
     */
    public static sumAggregatedTokens(rows: Array<{ _value?: number | string | boolean }>): number {
        const total = (rows || []).reduce((accumulator, row) => {
            const value = typeof row?._value === 'number' ? row._value : parseFloat(`${row?._value}`);
            return accumulator + (Number.isFinite(value) ? value : 0);
        }, 0);
        if (!Number.isFinite(total) || total === 0) {
            return 0;
        }
        return parseFloat(total.toPrecision(12));
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
     * Schedules the job which closes a metering period. It runs every six hours and closes the six
     * hours behind it.
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
            const scheduleParameters: TokenAsyncAggregatorDto = {
                businessID,
                subject,
                dimensionType: TokenConsumerAsyncProcessor.aggregationProcessor,
            };
            await this.schedulerService.create({
                businessID,
                schedulerStatus: SchedulerStatus.live,
                subject,
                schedulerID: TokenConsumerAsyncProcessor.aggregationSchedulerIdGenerator(businessID),
                schedulerType: schedulerType.dimensionDataGathering,
                scheduleParameters,
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
