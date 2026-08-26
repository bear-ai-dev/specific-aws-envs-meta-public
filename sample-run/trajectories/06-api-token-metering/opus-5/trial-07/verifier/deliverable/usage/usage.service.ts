import { ConflictException, forwardRef, Inject, Injectable, Logger, Optional } from '@nestjs/common';
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
        @Optional()
        @Inject(forwardRef(() => TokenConsumerService))
        readonly tokenConsumerService?: TokenConsumerService,
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

    async create(createUsageDto: CreateUsageDto, subject?: string): Promise<BasicResponseDTO> {
        const entity = new StandardMeasurementEntity({
            ...createUsageDto,
            recordValue: parseFloat(createUsageDto?.recordValue),
            _measurement: UsageEntity._measurement,
        });
        StandardMeasurementEntity.publish(entity);
        // Accepting a measurement is a call against the platform's own product, register it
        // against the SaaS business' meteringco customer at the moment the measurement happened.
        await this.registerApiCallToken(createUsageDto, subject);

        return { message: 'Measurement created' };
    }

    /**
     * Meters the platform's own API traffic for an accepted measurement.
     *
     * The token is registered at the moment of the measurement itself, never at the moment the
     * measurement was handed over, so a late or repeated delivery lands in the period it belongs
     * to, and cannot be counted twice.
     */
    private async registerApiCallToken(createUsageDto: CreateUsageDto, subject?: string): Promise<void> {
        try {
            if (!this.tokenConsumerService) {
                return;
            }
            const uuid = UsageService.getMeasurementIdentifier(createUsageDto);
            await this.tokenConsumerService.register({
                businessID: createUsageDto?.businessID,
                subject,
                tokenAmount: TokenConsumerService.apiCallTokenAmount,
                timestamp: createUsageDto?.timestamp,
                metadata: {
                    tokenType: TokenType.apiCall,
                    ...(uuid ? { uuid } : {}),
                },
            });
        } catch (e) {
            UsageService.logger.error('Failed to meter token for measurement', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to meter token for measurement',
                data: [serializeError(e)],
            });
        }
    }

    /**
     * Identifying metadata for an accepted measurement. Delivery is at-least-once, when the
     * producer hands us an identifier it is kept so the repeat registers the same token.
     */
    public static getMeasurementIdentifier(createUsageDto: CreateUsageDto): string | undefined {
        const metadata = createUsageDto?.metadata;
        const identifier =
            metadata?.uuid || metadata?.idempotencyKey || metadata?.messageId || metadata?.eventId || metadata?.id;
        return identifier || identifier === 0 ? `${identifier}` : undefined;
    }
}
