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
import { InfluxService } from '../influx/influx.service.js';
import { TokenConsumer } from './entities/token-consumer.entity.js';
import { TokenType } from './dto/TokenType.js';
import { UsageEntity } from '../usage/entities/usage.entity.js';

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
                try {
                    const influx = this.influxService || new InfluxService();
                    const isProd = saasCustomerAssociatedBusinessID === 'meteringco-production';
                    const usageBusinessID = saasCustomerAssociatedBusinessID;
                    // Dimension for apiCall traffic - production vs sandbox
                    let dimensionId: string;
                    if (meteringcoToken.metadata?.tokenType === TokenType.apiCall) {
                        dimensionId = isProd ? '697f07d0-3180-4351-bdff-7ca029e6c18d' : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                    } else {
                        // For other token types, still use same mapping if meteringco account, otherwise fallback
                        dimensionId = isProd ? '697f07d0-3180-4351-bdff-7ca029e6c18d' : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                        // Try to resolve via offering if available
                        try {
                            const offeringRes = await InfluxService.getMeteringCoOffering('94494cdf-d090-4032-8fc7-1e9b9e7f49cb');
                            if (offeringRes?.dimensions?.length) {
                                const match = offeringRes.dimensions.find((d) => d.businessID === usageBusinessID);
                                if (match) dimensionId = match.dimensionId;
                                // also try to find by tokenType if metadata present
                            }
                        } catch {}
                    }
                    const point = influx.getPoint(UsageEntity._measurement);
                    point.tag('customerId', meteringcoCustomerId);
                    point.tag('businessID', usageBusinessID);
                    point.tag('dimensionId', dimensionId);
                    point.floatField('recordValue', parseFloat(meteringcoToken.tokenAmount));
                    const ts = meteringcoToken.timestamp ? new Date(meteringcoToken.timestamp) : new Date();
                    point.timestamp(ts);
                    if (meteringcoToken.metadata) {
                        for (const [k, v] of Object.entries(meteringcoToken.metadata)) {
                            if (v !== undefined && v !== null) {
                                point.tag(`metadata_${k}`, JSON.stringify(v));
                            }
                        }
                    }
                    const bucket = `${process.env.STAGE}-usage-data`;
                    await influx.loadPoints(bucket, process.env.INFLUX_ORG || 'meteringco', [point], true);
                } catch (e) {
                    TokenConsumerService.logger.error('Failed to write billable usage', serializeError(e));
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

    async recordApiCall({
        businessID,
        subject,
        amount,
        timestamp,
        metadata,
    }: {
        businessID: string;
        subject?: string;
        amount: string | number;
        timestamp: string;
        metadata?: Record<string, string>;
    }): Promise<void> {
        try {
            const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentSerivce);
            if (!res) {
                TokenConsumerService.logger.warn(`No meteringco customer for businessID ${businessID}, skipping apiCall record`);
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = res;
            const influx = this.influxService || new InfluxService();
            const point = influx.getPoint(TokenConsumer._measurement);
            point.tag('customerId', meteringcoCustomerId);
            point.tag('businessID', saasCustomerAssociatedBusinessID);
            const isProd = saasCustomerAssociatedBusinessID === 'meteringco-production';
            const dimensionId = isProd ? '697f07d0-3180-4351-bdff-7ca029e6c18d' : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
            point.tag('dimensionId', dimensionId);
            // metadata tags
            const tokenType = metadata?.tokenType || TokenType.apiCall;
            point.tag('metadata_tokenType', JSON.stringify(tokenType));
            if (metadata?.uuid) {
                point.tag('metadata_uuid', JSON.stringify(metadata.uuid));
            }
            // include any additional metadata as tags (excluding already handled)
            if (metadata) {
                for (const [k, v] of Object.entries(metadata)) {
                    if (k === 'tokenType' || k === 'uuid') continue;
                    if (v !== undefined && v !== null) {
                        point.tag(`metadata_${k}`, JSON.stringify(v));
                    }
                }
            }
            point.floatField('recordValue', typeof amount === 'string' ? parseFloat(amount) : amount);
            const ts = timestamp ? new Date(timestamp) : new Date();
            point.timestamp(ts);
            const bucket = TokenConsumerAsyncProcessor.tokenAggregateBucket;
            // Must not add round trip to request: use flush false and do not await flush
            // Fire and forget but still ensure write is attempted; we do not await the outer promise in caller.
            influx.loadPoints(bucket, process.env.INFLUX_ORG || 'meteringco', [point], false).then(() => {
                // Ensure flush happens asynchronously without blocking request
                const api = (influx as any).writeApis?.[bucket];
                if (api && api.flush) {
                    api.flush().catch((e) => {
                        TokenConsumerService.logger.error('Failed to flush apiCall point', serializeError(e));
                    });
                }
            }).catch((e) => {
                TokenConsumerService.logger.error('Failed to record apiCall', serializeError(e));
                AuditService.publishEvent({ topic: AuditScope.ERROR, message: 'Failed to record apiCall', data: [serializeError(e)] });
            });
        } catch (e) {
            TokenConsumerService.logger.error('Failed to record apiCall', serializeError(e));
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
