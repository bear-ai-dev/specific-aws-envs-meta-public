import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { CreateMeasurementDto } from './dto/createMeasurement.dto.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { InfluxService } from '../influx/influx.service.js';
import { MeasurementEntity } from './entities/measurement.entity.js';
import { ReadMeasurementDTO } from './dto/readMeasurements.dto.js';
import { CreateDimensionDto } from 'dimensions/dto/create-dimension.dto.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { EnvironmentService } from '../users/users.service.js';
import { randomUUID } from 'crypto';
import { serializeError } from 'serialize-error';

@Injectable()
export class MeasurementService {
    private static readonly logger = new Logger(MeasurementService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentService: EnvironmentService,
    ) {}

    async create(createMeasurementDto: CreateMeasurementDto) {
        // Add Measurement to Influx
        const { loadPoints } = this.InfluxService;
        const pricingModel = new MeasurementEntity(createMeasurementDto);
        const dbModel = MeasurementEntity.transformer(pricingModel, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, dbModel);
        // Accepting a measurement counts as one API call – meter it
        try {
            const businessID = (createMeasurementDto as any).businessID;
            if (businessID) {
                void (async () => {
                    try {
                        let svc: any = this.tokenConsumerService;
                        if (!svc || !svc.registerApiCall) {
                            const influx = this.InfluxService || new InfluxService();
                            const env = this.environmentService || new EnvironmentService(influx);
                            const { TokenConsumerService: TCS } = await import('../token-consumer/token-consumer.service.js');
                            svc = new TCS(null as any, null as any, env, influx);
                        }
                        await svc.registerApiCall({
                            businessID,
                            timestamp: (createMeasurementDto as any).timestamp || new Date().toISOString(),
                            amount: 1,
                            metadata: { uuid: randomUUID(), tokenType: 'apiCall' },
                        });
                    } catch (e) {
                        MeasurementService.logger.error('Failed to meter measurement apiCall', serializeError(e));
                    }
                })();
            }
        } catch (e) {
            MeasurementService.logger.error('Failed to meter measurement apiCall', serializeError(e));
        }
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
