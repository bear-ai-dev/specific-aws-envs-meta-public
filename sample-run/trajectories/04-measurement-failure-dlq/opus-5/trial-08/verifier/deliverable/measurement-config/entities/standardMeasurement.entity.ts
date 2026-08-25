import { Tag } from '@aws-sdk/client-ec2';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { InfluxService } from '../../influx/influx.service.js';
import { DeploymentType } from '../../kubernetes-deployer/dto/DeploymentType.js';
import { KafkaManager } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaClient.entity.js';
import { KafkaDeploymentParametersEntity } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaDeploymentParametersEntity.js';
import { KafkaSecurityMechanism } from '../../kubernetes-deployer/entities/kafkaConsumer/KafkaSecurityMechanism.js';
import { MeasurementFormat } from './measurement.interface.js';
import { putDocument } from '../../utils/aws/s3.js';

const eventEmitter = new EventEmitter();
export enum DlqType {
    kafka = 'kafka',
    s3 = 's3',
}

/**
 * Prefix utilized when a failed message has no known source file in the datastore,
 * this keeps the message instead of dropping it on the floor.
 */
export const UNKNOWN_DLQ_PREFIX = 'meteringco-unknown';
export class StandardMeasurementEntity implements MeasurementFormat {
    private static readonly logger = new Logger(StandardMeasurementEntity.name);
    public timestamp?: string;
    public dimensionId?: string;
    public businessID: string;
    public customerId: string;
    public recordValue: number;
    public metadata?: Record<string, string | number | null>;
    public _measurement: string;
    public static allowedTags = ['meteringcoCustomerId', 'meteringcoDimensionId'];

    constructor(measurement: MeasurementFormat) {
        if (measurement.timestamp) {
            this.timestamp = measurement.timestamp;
        } else {
            this.timestamp = new Date().toISOString();
        }
        this.dimensionId = measurement.dimensionId;
        this.customerId = measurement.customerId;
        this.recordValue = measurement.recordValue;
        this.metadata = measurement.metadata;
        this.businessID = measurement.businessID;
        this._measurement = measurement._measurement;
    }
    static publish(publishRequest: MeasurementFormat) {
        eventEmitter.emit('standardMeasurements', publishRequest);
        return {
            message: 'published',
            id: randomUUID(),
            data: [publishRequest],
        };
    }
    static subscribe(influxService: InfluxService) {
        eventEmitter.on('standardMeasurements', async (measurementFormat: MeasurementFormat) => {
            const point = MeasurementFormat.getPointForm(measurementFormat, influxService);
            try {
                await influxService.loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, [point]);
            } catch (err) {
                AuditService.publishEvent({
                    data: [{ err }],
                    message: 'Failed to index Measurement',
                    topic: AuditScope.ERROR,
                });
            }
        });
    }
    static awsTagKeyReducer(Tags: Tag[]) {
        if (Tags) {
            return Tags.reduce((acc, { Key, Value }): any => {
                if (StandardMeasurementEntity.allowedTags.includes(Key)) {
                    acc[Key] = Value;
                }
                return acc;
            }, {});
        } else {
            return {};
        }
    }

    /**
     * Generates a unique, non colliding, key for the message in the DLQ bucket.
     * The message is stored underneath its source file, so the owning business can
     * correlate the failure with the file which produced it. A random suffix is added so
     * a previous failure of the same source file is never overwritten.
     */
    static generateS3DlqKey(orginalProcessedName?: string) {
        const source =
            orginalProcessedName && `${orginalProcessedName}`.length
                ? `${orginalProcessedName}`
                : `${UNKNOWN_DLQ_PREFIX}/${randomUUID()}`;
        return `${source}-${randomUUID().replace(/-/g, '').slice(0, 6)}.json`;
    }

    static async publishFailureToDLQ(failedDocument, metadata: MeasurementFailureMetadata, dlqType: DlqType) {
        if (dlqType === DlqType.s3) {
            const bucket = process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
            const key = StandardMeasurementEntity.generateS3DlqKey(metadata?.orginalProcessedName);
            try {
                if (!bucket) {
                    throw new Error('Missing DLQ bucket configuration, DB_MEASUREMENT_DLQ_BUCKET_NAME is not set');
                }
                const document = JSON.stringify({ failedDocument, metadata });
                await putDocument(document, bucket, key).done();
                StandardMeasurementEntity.logger.log(`Wrote failed datastore measurement to dlq s3://${bucket}/${key}`);
                return { bucket, key };
            } catch (e) {
                StandardMeasurementEntity.logger.error('error occurred writing to s3 dlq', e);
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Failed to write to DLQ',
                    data: [
                        {
                            errorCode: e?.Code,
                            errorMessage: e?.message,
                            errorName: e?.name,
                            bucket,
                            key,
                            failedDocument,
                            metadata,
                            dlqType,
                        },
                    ],
                });
                return;
            }
        }
        if (dlqType === DlqType.kafka) {
            StandardMeasurementEntity.logger.log(
                "write to kafka dlq isn't implemented yet",
                JSON.stringify({ failedDocument: failedDocument, metadata, dlqType }),
            );
            // Get the original deployment parameters from KafkaDeploymentParametersEntity
            const kafkaDeploymentParameters = new KafkaDeploymentParametersEntity();
            const { businessID, measurementId } = metadata;
            if (!businessID || !measurementId) {
                StandardMeasurementEntity.logger.error(
                    'Failed to write to kafka dlq, missing businessID or measurementId',
                );
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Failed to write to kafka dlq, missing businessID or measurementId',
                    data: [
                        {
                            failedDocument,
                            metadata,
                            dlqType,
                        },
                    ],
                });
                return;
            }
            try {
                const manager = await kafkaDeploymentParameters.getOriginalDeploymentParameters({
                    businessID,
                    uniqueId: measurementId,
                    deploymentType: DeploymentType.kafkaConsumer,
                });
                // Get the client
                const {
                    deploymentParameters: { securityMechanism, dlqTopic },
                } = manager;
                if (securityMechanism === KafkaSecurityMechanism.PLAIN) {
                    const client = new KafkaManager({
                        securityMechanism,
                        ...manager.deploymentParameters,
                        clientId: 'meteringco-dlq-writer',
                    } as {
                        securityMechanism: KafkaSecurityMechanism;
                        clientId: string;
                        username: string;
                        password: string;
                        bootstrapServerEndpoint: string;
                    });
                    const initalized = await KafkaManager.initalizeClient(client);
                    await KafkaManager.writeMessageToTopic({
                        client: initalized,
                        topic: dlqTopic,
                        message: JSON.stringify({ failedDocument: failedDocument, metadata }),
                        timestamp: new Date(metadata?.timestamp).getTime().toString(),
                    });
                } else {
                    throw new Error('Not implemented yet');
                }
            } catch (e) {
                StandardMeasurementEntity.logger.error('error occurred writing to dlq', e);
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Failed to write to DLQ',
                    data: [
                        {
                            errorCode: e?.Code,
                            errorMessage: e?.message,
                            errorName: e?.name,
                            failedDocument,
                            metadata,
                            dlqType,
                        },
                    ],
                });
                return;
            }
            // Write to the topic
        }
    }
}

export class MeasurementFailureMetadata {
    timestamp: string;
    results: string;
    errorInfo: any;

    /**
     * This is the processed name from the system where the measurement occured
     * In S3 its the complete fileName
     * */
    orginalProcessedName: string;
    businessID?: string;
    measurementId?: string;

    constructor({
        timestamp,
        results,
        businessID,
        measurementId,
        errorInfo,
        orginalProcessedName,
    }: MeasurementFailureMetadata) {
        this.timestamp = timestamp;
        this.results = results;
        this.businessID = businessID;
        this.measurementId = measurementId;
        this.errorInfo = errorInfo;
        this.orginalProcessedName = orginalProcessedName;
    }
}
