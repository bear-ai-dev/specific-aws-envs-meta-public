import { InfluxService } from '../../influx/influx.service.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { StandardMeasurementEntity } from './standardMeasurement.entity.js';

export enum PreProcessorMeasurementType {
    AGENT = 'AGENT',
}

// Take in a raw data value which doesn't have customerId, and or DimesnionId plus additional metadata
// Attach meatadata to the raw data value creating a standard measurement
// Publish the standard measurement to the standard measurement topic
// Contains a constructor to create the pre-processing entity, and then a method to process the raw data value doing the above steps.
export class StandardMeasurementPreProcessorEntity {
    // The raw data value
    public rawDataValue: string;
    // The businessID
    public businessID: string;
    // ENUM of the type of measurement
    public measurementType: PreProcessorMeasurementType;
    // metadata as a JSON object keys are the metadata names values are strings
    public metadata: Record<string, string>;
    // Optional Timestamp, if not provided will be set to the current time
    public timestamp?: string;

    constructor(
        rawDataValue: string,
        businessID: string,
        measurementType: PreProcessorMeasurementType,
        metadata: Record<string, string>,
        timestamp?: string,
    ) {
        this.rawDataValue = rawDataValue;
        this.businessID = businessID;
        this.measurementType = measurementType;
        this.metadata = metadata;
        if (timestamp) {
            this.timestamp = timestamp;
        } else {
            this.timestamp = new Date().toISOString();
        }
    }
    static async createStandardMeasurement(
        preprocessed: StandardMeasurementPreProcessorEntity,
        uniqueInfrastructureId: string,
        influxService: InfluxService,
    ) {
        let dimensionId;
        let customerId;
        if (preprocessed.measurementType === PreProcessorMeasurementType.AGENT) {
            const startTime = new Date('January 1, 1970 00:00:00');
            const endTime = new Date();
            // get the dimensionId, and customerId from Influx
            const data = await influxService.getLatestPodLabelsByID({
                podId: uniqueInfrastructureId,
                businessID: preprocessed.businessID,
                startTime: startTime.toISOString(),
                endTime: endTime.toISOString(),
            });
            // Get the instance information about the pod from Influx

            if (data.length > 0) {
                const [{ label_meteringco_dimension_id, label_meteringco_customer_id }] = data;
                dimensionId = label_meteringco_dimension_id;
                customerId = label_meteringco_customer_id;
            } else {
                return { message: 'No labels found' };
            }
        }

        const standardMeasurement = new StandardMeasurementEntity({
            businessID: preprocessed.businessID,
            recordValue: Number(preprocessed.rawDataValue),
            metadata: preprocessed.metadata,
            _measurement: UsageEntity._measurement,
            timestamp: preprocessed.timestamp,
            dimensionId,
            customerId,
        });
        StandardMeasurementEntity.publish(standardMeasurement);
    }
}
