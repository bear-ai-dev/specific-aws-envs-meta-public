import { ConflictException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { CustomerService } from '../customer/customer.service.js';
import {
    AggregatedUsageResponse,
    MetadataGroupedAggregatedUsageResponse,
    QueryParamUsageDto,
    UnAggregatedUsageResponse,
} from '../customer/dto/read-customer.dto.js';

import { DimensionsService } from '../dimensions/dimensions.service.js';
import { InfluxService } from '../influx/influx.service.js';
import { StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity.js';

import { MeasurementConfigService } from '../measurement-config/measurement-config.service.js';
import { OfferingService } from '../offering/offering.service.js';
import { CreateUsageDto } from './dto/create-usage.dto.js';
import { ReadUsageForCustomerDto } from './dto/read-usage.dto.js';
import { UsageEntity } from './entities/usage.entity.js';
import { aggregationInterval } from '../dimensions/dto/create-dimension.dto.js';
import { DatetimeUtils } from '../utils/datetime.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { TokenType } from '../token-consumer/dto/TokenType.js';
import { MeteringCoToken } from '../token-consumer/dto/meteringcoToken.dto.js';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';

const ONE_DAY_IN_MS = 864e5;
@Injectable()
export class UsageService {
    private static readonly logger = new Logger(UsageService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        @Inject(forwardRef(() => MeasurementConfigService)) readonly measurementConfigService: MeasurementConfigService,
        @Inject(forwardRef(() => DimensionsService)) readonly dimensionService: DimensionsService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
    ) {}
    findAll() {
        return `This action returns all usage`;
    }

    async findUsageForCustomer(
        { customerId, businessID, customer }: ReadUsageForCustomerDto,
        overrides: QueryParamUsageDto,
    ): Promise<(AggregatedUsageResponse | UnAggregatedUsageResponse | MetadataGroupedAggregatedUsageResponse)[]> {
        let offering;
        if (customer === undefined) {
            const {
                data: [{ offering: readOffering }],
            } = await this.customerService.findOne({ customerId, businessID });
            offering = readOffering;
        } else {
            offering = customer.offering;
        }
        if (offering) {
            let aggregateData: (
                | AggregatedUsageResponse
                | UnAggregatedUsageResponse
                | MetadataGroupedAggregatedUsageResponse
            )[] = [];
            let endDate: string;
            let startTime: string;
            if (overrides?.aggregationInterval === aggregationInterval.month) {
                endDate = DatetimeUtils.endOfDay(DatetimeUtils.getLastDayOfMonthGivenDate(new Date())).toISOString();
                startTime = DatetimeUtils.getStartOfMonthGivenDate(new Date()).toISOString();
            } else {
                endDate = new Date().toISOString();
                startTime = new Date(Date.now() - ONE_DAY_IN_MS).toISOString();
            }
            if (Array.isArray(offering)) {
                const res = await Promise.all(
                    offering.map((off) => {
                        const { dimensions, ...restOfOfferingDoc } = off;
                        let setDimensions = dimensions;
                        if (overrides?.aggregationInterval) {
                            setDimensions = dimensions.map((dimension) => ({
                                ...dimension,
                                aggregationInterval: overrides.aggregationInterval,
                            }));
                        }
                        return this.influxService.getAggregateUsageForDimension({
                            customerId,
                            businessID,
                            startTime: overrides?.startTime ? overrides?.startTime : startTime,
                            endTime: overrides?.endTime ? overrides?.endTime : endDate,
                            influxService: this.influxService,
                            clientID: customerId,
                            offeringDocument: { dimensions: setDimensions, ...restOfOfferingDoc },
                            aggregationPurpose: overrides?.aggregationPurpose,
                        });
                    }),
                );
                aggregateData = res.flat();
                return aggregateData;
            } else {
                const { dimensions, ...restOfOfferingDoc } = offering;
                let setDimensions = dimensions;
                if (overrides?.aggregationInterval) {
                    setDimensions = dimensions.map((dimension) => ({
                        ...dimension,
                        aggregationInterval: overrides.aggregationInterval,
                    }));
                }

                UsageService.logger.debug(
                    `Gathering Usage for businessID: ${businessID} and customerId: ${customerId}`,
                );
                const aggregateData = await this.influxService.getAggregateUsageForDimension({
                    customerId,
                    businessID,
                    startTime: overrides?.startTime ? overrides?.startTime : startTime,
                    endTime: overrides?.endTime ? overrides?.endTime : endDate,
                    influxService: this.influxService,
                    clientID: customerId,
                    offeringDocument: { dimensions: setDimensions, ...restOfOfferingDoc },
                    aggregationPurpose: overrides?.aggregationPurpose,
                });
                return aggregateData;
            }
        } else {
            return [];
        }
    }

    /**
     * A stable identifier for the API call which handed a measurement over, derived from the
     * measurement itself so that a redelivery of it is recognised as the very same call.
     */
    public static measurementCallId(measurement: StandardMeasurementEntity): string {
        return createHash('sha1')
            .update(
                [
                    measurement?.businessID,
                    measurement?.customerId,
                    measurement?.dimensionId,
                    measurement?.recordValue,
                    measurement?.timestamp,
                    JSON.stringify(measurement?.metadata ? measurement.metadata : {}),
                ].join('|'),
            )
            .digest('hex');
    }

    async create(createUsageDto: CreateUsageDto, subject?: string): Promise<BasicResponseDTO> {
        const entity = new StandardMeasurementEntity({
            ...createUsageDto,
            recordValue: parseFloat(createUsageDto?.recordValue),
            _measurement: UsageEntity._measurement,
        });
        StandardMeasurementEntity.publish(entity);
        try {
            // Accepting a measurement from a tenant is a single API call against meteringco's own product.
            // Measurements are delivered at-least-once and out of order, so the call is registered at
            // the moment of the measurement it carries, identified by the measurement itself. The same
            // measurement handed over twice therefore records the same single call, in the same period,
            // however long after the fact the second hand over shows up.
            await this.tokenConsumerService.registerToken({
                businessID: createUsageDto?.businessID,
                subject,
                tokenAmount: TokenConsumerService.apiCallTokenAmount,
                timestamp: entity.timestamp,
                metadata: {
                    tokenType: TokenType.apiCall,
                    uuid: UsageService.measurementCallId(entity),
                },
            } as MeteringCoToken);
        } catch (e) {
            UsageService.logger.error('Failed to register api call token for measurement', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to register api call token for measurement',
                data: [serializeError(e)],
            });
        }

        return { message: 'Measurement created' };
    }
}
