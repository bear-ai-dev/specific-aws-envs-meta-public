import { Inject, Injectable, Logger, forwardRef, Optional } from '@nestjs/common';
import { CreateMeasurementDto } from './dto/createMeasurement.dto.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { InfluxService } from '../influx/influx.service.js';
import { MeasurementEntity } from './entities/measurement.entity.js';
import { ReadMeasurementDTO } from './dto/readMeasurements.dto.js';
import { CreateDimensionDto } from 'dimensions/dto/create-dimension.dto.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { TokenType } from '../token-consumer/dto/TokenType.js';
import { EnvironmentService } from '../users/users.service.js';
import { TokenConsumer } from '../token-consumer/entities/token-consumer.entity.js';
import { TokenConsumerAsyncProcessor } from '../token-consumer/token-consumer-async-processor.js';
import { randomUUID } from 'crypto';

@Injectable()
export class MeasurementService {
    private static readonly logger = new Logger(MeasurementService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Optional() @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
        @Optional() @Inject(forwardRef(() => EnvironmentService)) readonly environmentService: EnvironmentService,
    ) {}

    async create(createMeasurementDto: CreateMeasurementDto) {
        // Add Measurement to Influx
        const { loadPoints } = this.InfluxService;
        const pricingModel = new MeasurementEntity(createMeasurementDto);
        const dbModel = MeasurementEntity.transformer(pricingModel, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, dbModel);

        // Also count as one API call for the platform's own metering (accepting a measurement)
        // Fire-and-forget, must not add round trip to the request
        void (async () => {
            try {
                const businessID = (createMeasurementDto as any).businessID;
                const subject = (createMeasurementDto as any).subject;
                if (!businessID) return;
                // Use tokenConsumerService if available, else static helper
                if (this.tokenConsumerService && this.environmentService) {
                    await this.tokenConsumerService.recordApiCall({
                        businessID,
                        tokenAmount: '1',
                        subject,
                        metadata: { tokenType: TokenType.apiCall, uuid: randomUUID(), source: 'measurement' },
                        timestamp: new Date().toISOString(),
                    } as any);
                } else {
                    // Fallback static: use Influx directly
                    const env = this.environmentService || new EnvironmentService(this.InfluxService);
                    const res = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, env as any);
                    if (!res) return;
                    const platformBusinessID = res.meteringcoCustomer.businessID;
                    const dimensionId = platformBusinessID === 'meteringco-production'
                        ? '697f07d0-3180-4351-bdff-7ca029e6c18d'
                        : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                    const influx = this.InfluxService;
                    const point = influx.getPoint(TokenConsumer._measurement);
                    point.tag('customerId', res.meteringcoCustomerId);
                    point.tag('businessID', platformBusinessID);
                    point.tag('dimensionId', dimensionId);
                    point.tag('metadata_tokenType', JSON.stringify(TokenType.apiCall));
                    point.tag('metadata_uuid', JSON.stringify(randomUUID()));
                    point.floatField('recordValue', 1);
                    point.timestamp(new Date());
                    void influx.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, process.env.INFLUX_ORG, [point], true).catch(() => {});
                }
            } catch (e) {
                MeasurementService.logger.error('Failed to meter measurement apiCall', e as any);
            }
        })();

        return { message: 'Added Measurement' };
    }

    async findAll({ startTime, endTime, infrastructureType, businessID }: ReadMeasurementDTO) {
        MeasurementService.logger.debug('Querying for Metrics', { startTime, endTime, infrastructureType, businessID });
        return {
            data: ReadMeasurementDTO.getMeasurmentDTO(
                await this.InfluxService.getMeasurementsBetweenDateRange({
                    startTime,
                    endTime,
                    infrastructureType,
                    businessID,
                }),
            ),
            message: 'Found Measurements',
        };
    }

    async remove({ startTime, endTime, infrastructureType, businessID }) {
        await this.InfluxService.dropMeasurementsBetweenDateRanges(
            `${process.env.STAGE}-usage-data`,
            process.env.INFLUX_ORG,
            {
                startTime,
                endTime,
                infrastructureType,
                businessID,
            },
        );
        return { message: 'removed measurements' };
    }
}
