import { Tag } from '@aws-sdk/client-ec2';
import { Logger } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import EventEmitter from 'events';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { InfluxService } from '../../influx/influx.service.js';
import { DeploymentType } from '../../kubernetes-deployer/dto/DeploymentType.js';
import { KafkaManager } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaClient.entity.js';
import { KafkaDeploymentParametersEntity } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaDeploymentParametersEntity.js';
import { KafkaSecurityMechanism } from '../../kubernetes-deployer/entities/kafkaConsumer/KafkaSecurityMechanism.js';
import { objectExists, putObject } from '../../utils/aws/s3.js';
import { MeasurementFormat } from './measurement.interface.js';

const eventEmitter = new EventEmitter();
export enum DlqType {
    kafka = 'kafka',
    /** Object store (S3) backed dead letter queue used by the datastore (S3) measurement system */
    s3 = 's3',
    /** Alias of {@link DlqType.s3}, the datastore measurement system is backed by S3 */
    datastore = 's3',
}

/** Prefix used in the dlq bucket when the failed message can't be traced back to a source file */
export const UNKNOWN_DLQ_SOURCE_PREFIX = 'meteringco-unknown';
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
     * Builds a short random suffix which keeps every dlq object unique, even when the very same
     * source file is rejected multiple times.
     */
    private static dlqKeySuffix(): string {
        return randomBytes(8).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6);
    }

    /**
     * Resolves the object key to be used in the dlq bucket. The key is derived from the source file
     * of the message (so the owning business can find its own failures under its own prefix) with a
     * random suffix appended so an earlier rejection of the same source file is never overwritten.
     */
    static async buildDLQObjectKey(bucket: string, sourceName: string): Promise<string> {
        const source =
            sourceName && `${sourceName}`.trim().length
                ? `${sourceName}`
                : `${UNKNOWN_DLQ_SOURCE_PREFIX}/${randomUUID()}`;
        for (let attempt = 0; attempt < 5; attempt++) {
            const key = `${source}-${StandardMeasurementEntity.dlqKeySuffix()}.json`;
            try {
                if (!(await objectExists(bucket, key))) {
                    return key;
                }
            } catch (e) {
                // Unable to verify, the random suffix makes a collision extremely unlikely anyway
                StandardMeasurementEntity.logger.warn(
                    `Unable to verify if dlq object ${key} already exists, ${e?.message}`,
                );
                return key;
            }
        }
        return `${source}-${randomUUID()}.json`;
    }

    /**
     * Persists a rejected datastore (S3) measurement in the dlq bucket, next to the prefix of the
     * source file it originated from, keeping the original content plus the failure information.
     */
    private static async publishFailureToS3DLQ(failedDocument, metadata: MeasurementFailureMetadata) {
        const bucket = process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
        try {
            if (!bucket) {
                throw new Error('Missing DB_MEASUREMENT_DLQ_BUCKET_NAME configuration, cannot write to the s3 dlq');
            }
            const sourceName = metadata?.orginalProcessedName ?? failedDocument?.s3Key;
            const key = await StandardMeasurementEntity.buildDLQObjectKey(bucket, sourceName);
            await putObject(JSON.stringify({ failedDocument, metadata }), bucket, key);
            StandardMeasurementEntity.logger.log(`Wrote failed datastore measurement to dlq s3://${bucket}/${key}`);
            return { bucket, key };
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
                        dlqType: DlqType.s3,
                    },
                ],
            });
            return;
        }
    }

    static async publishFailureToDLQ(failedDocument, metadata: MeasurementFailureMetadata, dlqType: DlqType) {
        if (dlqType !== DlqType.kafka) {
            // Everything which isn't fed by kafka is a datastore (S3) sourced measurement
            return StandardMeasurementEntity.publishFailureToS3DLQ(failedDocument, metadata);
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

    constructor({ timestamp, results, businessID, measurementId }: MeasurementFailureMetadata) {
        this.timestamp = timestamp;
        this.results = results;
        this.businessID = businessID;
        this.measurementId = measurementId;
    }
}
