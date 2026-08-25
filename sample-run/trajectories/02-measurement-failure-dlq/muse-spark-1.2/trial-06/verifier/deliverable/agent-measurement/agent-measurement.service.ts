import { Point } from '@influxdata/influxdb-client';
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import {
    PreProcessorMeasurementType,
    StandardMeasurementPreProcessorEntity,
} from '../measurement-config/entities/standardMeasurementPreProcessor.js';
import { CreateAgentMeasurementDto } from './dto/create-agent-measurement.dto.js';
import { timeBasedMetricNames } from './entities/agent-measurement.entity.js';

const MS_CONVERSION_FACTOR = 1000;
@Injectable()
export class AgentMeasurementService {
    private static readonly logger = new Logger(AgentMeasurementService.name);
    constructor(@Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService) {}
    async create(createAgentMeasurementDto: CreateAgentMeasurementDto) {
        const { timeseries, businessID } = createAgentMeasurementDto;

        await Promise.all(
            timeseries.map(async ({ labels, samples }) => {
                const { getPoint } = this.InfluxService;
                const { value: measurementName } = labels[0];
                await Promise.all(
                    samples.map(async ({ value, timeStamp }) => {
                        const point = AgentMeasurementService.createLabelPoint(getPoint, labels, measurementName);
                        point.tag('businessID', businessID);
                        if (Object.values(timeBasedMetricNames).includes(measurementName)) {
                            point.timestamp(new Date(value * MS_CONVERSION_FACTOR)); // Agent measurement is in seconds, Influxdb expects milliseconds for timestamp
                            if (Number.isNaN(value)) {
                                return false;
                            }
                            point.intField('value', value);
                            return point;
                        } else if (typeof value === 'number' && !Number.isNaN(value)) {
                            point.intField('value', value);
                        } else {
                            return false;
                        }
                        if (timeStamp) {
                            point.timestamp(timeStamp);
                        }
                        const metadata = labels.reduce((acc, { name, value }) => {
                            acc[name] = value;
                            return acc;
                        }, {});
                        if (metadata?.pod && metadata?.__name__ === 'kube_pod_container_status_running') {
                            const subDividedHour = 0.05;

                            const entity = new StandardMeasurementPreProcessorEntity(
                                subDividedHour.toString(),
                                businessID,
                                PreProcessorMeasurementType.AGENT,
                                metadata,
                                timeStamp,
                            );
                            await StandardMeasurementPreProcessorEntity.createStandardMeasurement(
                                entity,
                                metadata.pod,
                                this.InfluxService,
                            );
                        }
                    }),
                );
            }),
        );

        return 'This action adds a new agentMeasurement';
    }
    static createLabelPoint(getPoint, labeles, measurementName): Point {
        const agentMeasurementPoint = getPoint(`meteringco_${measurementName}`);

        labeles.forEach(({ name, value }) => {
            agentMeasurementPoint.tag(name, value);
        });
        return agentMeasurementPoint;
    }
}
