import { BadRequestException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { MeteringCoToken } from './dto/meteringcoToken.dto';
import { UserEntitlements } from '../users/entities/entitlement.entity';
import { cache as cacheManager } from '../cacheStore.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { SchedulerStatus, SupportedMeasurementFrequencies, schedulerType } from '../scheduler/dto/scheduler.dto.js';
import { TokenConsumerAsyncProcessor } from './token-consumer-async-processor.js';
import { ReadCustomerResponseData } from '../customer/entities/customer.entity.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { EnvironmentService } from '../users/users.service.js';
import { InfluxService } from '../influx/influx.service.js';
import { TokenType } from './dto/TokenType.js';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface.js';
import { TokenConsumer } from './entities/token-consumer.entity.js';

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
                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
                TokenConsumerService.logger.debug(`Metering Token for meteringco customerId: ${meteringcoCustomerId}`);
                // Turn token into billable usage against platform's own account
                // Determine production vs sandbox dimension
                let dimensionId: string;
                let usageBusinessID: string;
                if (saasCustomerAssociatedBusinessID === 'meteringco-production') {
                    dimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                    usageBusinessID = 'meteringco-production';
                } else {
                    dimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                    usageBusinessID = 'meteringco-sandbox';
                }
                const influx = this.influxService || new InfluxService();
                const measurement: any = {
                    customerId: meteringcoCustomerId,
                    businessID: usageBusinessID,
                    dimensionId,
                    recordValue: parseFloat(meteringcoToken.tokenAmount),
                    timestamp: meteringcoToken.timestamp || new Date().toISOString(),
                    metadata: meteringcoToken.metadata,
                    _measurement: 'usageMeasurement',
                };
                const point = MeasurementFormat.getPointForm(measurement, influx);
                await influx.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point], true);
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
    // Register an API call against the platform's own customer for that tenant
    // Recording must not add a round trip to the request it describes -> fire-and-forget with flush false
    async registerApiCall(meteringcoToken: MeteringCoToken): Promise<void> {
        try {
            const res = await TokenConsumerService.getMeteringCoCustomerId(
                meteringcoToken.businessID,
                meteringcoToken.subject,
                this.environmentSerivce,
            );
            if (!res) {
                TokenConsumerService.logger.error(`No customer found for businessID: ${meteringcoToken?.businessID} during registerApiCall`);
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const dimensionId = saasCustomerAssociatedBusinessID === 'meteringco-production'
                ? '697f07d0-3180-4351-bdff-7ca029e6c18d'
                : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
            const influx = this.influxService || new InfluxService();
            const point = influx.getPoint(TokenConsumer._measurement);
            point.tag('customerId', meteringcoCustomerId);
            point.tag('businessID', saasCustomerAssociatedBusinessID);
            point.tag('dimensionId', dimensionId);
            const tokenType = meteringcoToken.metadata?.tokenType ?? TokenType.apiCall;
            point.tag('metadata_tokenType', JSON.stringify(tokenType));
            // Identifying metadata - expect uuid key
            if (meteringcoToken.metadata) {
                for (const [k, v] of Object.entries(meteringcoToken.metadata)) {
                    if (k === 'tokenType') continue;
                    point.tag(`metadata_${k}`, JSON.stringify(v));
                }
            }
            point.floatField('recordValue', parseFloat(meteringcoToken.tokenAmount));
            const ts = meteringcoToken.timestamp ? new Date(meteringcoToken.timestamp) : new Date();
            point.timestamp(ts);
            // Fire-and-forget: do not await flush, use flush false to avoid round trip
            void influx.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, influx.org, [point], false).catch((e) => {
                TokenConsumerService.logger.error('Failed to record api call', serializeError(e));
            });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to record api call', serializeError(e));
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
                try {
                    const allEnvs = await environmentSerivce.getEnvironmentsForUser(subject);
                    businessIDs = allEnvs.map((env) => env.businessID);
                } catch (e) {
                    TokenConsumerService.logger.warn(`Failed to get environments for subject ${subject}, falling back to businessID ${businessID}`, e);
                    businessIDs = [businessID];
                }
                if (!businessIDs.length) businessIDs = [businessID];
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
