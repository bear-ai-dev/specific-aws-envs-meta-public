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
    /**
     * The prefix used for dead letter messages which cannot be traced back to a source file.
     */
    public static readonly unknownDlqSourcePrefix = 'meteringco-unknown';
    private static readonly dlqKeySuffixLength = 6;
    private static readonly dlqKeyAttempts = 10;

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
     * A short random suffix, it makes the dead letter key unique so a new failure of an already
     * failed source file never overwrites the previously stored message.
     */
    private static generateDlqKeySuffix(length: number = StandardMeasurementEntity.dlqKeySuffixLength) {
        const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
        return Array.from(randomBytes(length))
            .map((byte) => alphabet[byte % alphabet.length])
            .join('');
    }

    /**
     * Writes a failed datastore (S3) measurement to the datastore DLQ bucket. The message is stored
     * under the source file it originated from, so the owning business can locate it with the same
     * key it used for ingestion. Messages without a source file are kept under a generic prefix.
     */
    static async publishFailureToS3DLQ(failedDocument, metadata: MeasurementFailureMetadata) {
        const bucket = process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
        const source =
            metadata?.orginalProcessedName || `${StandardMeasurementEntity.unknownDlqSourcePrefix}/${randomUUID()}`;
        const dlqMetadata = { ...metadata, orginalProcessedName: source };
        const document = JSON.stringify({ failedDocument, metadata: dlqMetadata });
        if (!bucket) {
            StandardMeasurementEntity.logger.error('Failed to write to s3 dlq, missing dlq bucket configuration');
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to write to DLQ',
                data: [
                    {
                        errorMessage: 'Missing datastore DLQ bucket configuration',
                        failedDocument,
                        metadata: dlqMetadata,
                        dlqType: DlqType.s3,
                    },
                ],
            });
            return;
        }
        try {
            for (let attempt = 0; attempt < StandardMeasurementEntity.dlqKeyAttempts; attempt++) {
                // A longer suffix on every retry guarantees the message is kept even when a key is taken
                const suffix = StandardMeasurementEntity.generateDlqKeySuffix(
                    StandardMeasurementEntity.dlqKeySuffixLength + attempt,
                );
                const key = `${source}-${suffix}.json`;
                // Never overwrite an earlier failure of the same source file
                if (await documentExists(bucket, key)) {
                    continue;
                }
                await putDocument(document, bucket, key).done();
                StandardMeasurementEntity.logger.log(`Wrote failed datastore measurement to s3://${bucket}/${key}`);
                return { bucket, key };
            }
            throw new Error(`Unable to generate a unique DLQ key for ${source}`);
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
                        metadata: dlqMetadata,
                        dlqType: DlqType.s3,
                    },
                ],
            });
            return;
        }
    }

    static async publishFailureToDLQ(failedDocument, metadata: MeasurementFailureMetadata, dlqType: DlqType) {
        if (dlqType === DlqType.s3) {
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

    constructor({
        timestamp,
        results,
        errorInfo,
        orginalProcessedName,
        businessID,
        measurementId,
    }: MeasurementFailureMetadata) {
        this.timestamp = timestamp;
        this.results = results;
        this.errorInfo = errorInfo;
        this.orginalProcessedName = orginalProcessedName;
        this.businessID = businessID;
        this.measurementId = measurementId;
    }
}
