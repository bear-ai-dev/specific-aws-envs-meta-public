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
import { MeasurementFormat } from './measurement.interface.js';
import { documentExists, putDocument } from '../../utils/aws/s3.js';

const eventEmitter = new EventEmitter();
export enum DlqType {
    kafka = 'kafka',
    s3 = 's3',
}
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
    /** Prefix used in the DLQ for messages which have no known source file/business */
    public static readonly unknownDLQPrefix = 'meteringco-unknown';
    private static readonly dlqKeySuffixLength = 6;
    private static readonly dlqKeyMaxAttempts = 5;

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

    static async publishFailureToDLQ(failedDocument, metadata: MeasurementFailureMetadata, dlqType: DlqType) {
        if (dlqType === DlqType.s3) {
            return StandardMeasurementEntity.writeFailureToS3DLQ(failedDocument, metadata);
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

    /**
     * Builds the failure information stored next to a rejected message.
     * Only the useful, serializable parts of the failure are kept (never the stack trace).
     * `class-validator` rejects with an array of validation errors, those are flattened into a
     * readable message so the owning business can tell what was wrong with its data.
     */
    static buildDLQErrorInfo(e): { name: string; message: string } {
        if (Array.isArray(e)) {
            const message = e
                .map((validationError) =>
                    validationError?.constraints
                        ? Object.values(validationError.constraints).join(', ')
                        : validationError?.toString?.(),
                )
                .filter(Boolean)
                .join('; ');
            return { name: 'ValidationError', message };
        }
        return { name: e?.name, message: e?.message };
    }

    /**
     * Builds the dead letter queue key for a failed message.
     * The key is prefixed by the name of the file the message originated from, this keeps the
     * failed message inside of the prefix owned by the business which produced it, and makes it
     * possible to find every failure for a given source file. A random suffix is appended so a
     * message never overwrites a previously stored failure of the same source file.
     */
    static buildDLQKey(sourceName: string) {
        const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const suffix = Array.from(randomBytes(StandardMeasurementEntity.dlqKeySuffixLength))
            .map((byte) => alphabet[byte % alphabet.length])
            .join('');
        return `${sourceName}-${suffix}.json`;
    }

    /**
     * Writes a rejected datastore (S3) sourced measurement to the datastore dead letter bucket.
     * The original input, along with information about the failure, is preserved under the name of
     * the file the message was read from. Messages without a known source file are kept under the
     * `meteringco-unknown` prefix so they are never dropped.
     *
     * Failures to write to the dead letter bucket are logged/audited and never thrown, the caller
     * is always expected to reject the message back to the producer.
     */
    private static async writeFailureToS3DLQ(failedDocument, metadata: MeasurementFailureMetadata) {
        const bucket = process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
        const sourceName =
            metadata?.orginalProcessedName || `${StandardMeasurementEntity.unknownDLQPrefix}/${randomUUID()}`;
        const dlqDocument = {
            failedDocument,
            metadata: { ...metadata, orginalProcessedName: sourceName },
        };
        try {
            if (!bucket) {
                throw new Error('Missing datastore DLQ bucket configuration, DB_MEASUREMENT_DLQ_BUCKET_NAME is unset');
            }
            let key = StandardMeasurementEntity.buildDLQKey(sourceName);
            let attempts = 0;
            // Guarantee an earlier failure of the same source file is never overwritten
            while (attempts < StandardMeasurementEntity.dlqKeyMaxAttempts && (await documentExists(bucket, key))) {
                key = StandardMeasurementEntity.buildDLQKey(sourceName);
                attempts++;
            }
            await putDocument(JSON.stringify(dlqDocument), bucket, key).done();
            StandardMeasurementEntity.logger.log(`Wrote failed datastore measurement to DLQ s3://${bucket}/${key}`);
            return { bucket, key };
        } catch (e) {
            StandardMeasurementEntity.logger.error('error occurred writing to the datastore dlq', e);
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
