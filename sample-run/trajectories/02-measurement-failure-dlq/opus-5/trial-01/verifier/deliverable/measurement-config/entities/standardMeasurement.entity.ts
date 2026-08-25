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
import { putDocumentWithoutOverwrite } from '../../utils/aws/s3.js';
import { randomBytes } from 'crypto';
import { serializeError } from 'serialize-error';

const eventEmitter = new EventEmitter();
export enum DlqType {
    kafka = 'kafka',
    s3 = 's3',
    datastore = 'datastore',
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
     * The prefix used for failures which cannot be tied back to a source file in the datastore.
     * Those messages are still retained so they can be inspected manually.
     */
    public static readonly unknownDlqSourcePrefix = 'meteringco-unknown';

    /**
     * Turns a thrown failure into something which is useful, and safe, to store alongside
     * a rejected message. Stacks are dropped as they leak implementation details, while
     * validation failures (an array of `ValidationError`) are kept in full.
     */
    static serializeMeasurementFailure(e) {
        if (e instanceof Error) {
            e.stack = undefined;
            return { name: e.name, message: e.message };
        }
        return serializeError(e);
    }

    /**
     * Builds the key a failure is stored under in the datastore DLQ bucket.
     * The key is namespaced by the original source file (which starts with the businessID),
     * so the owning business is able to locate every rejection of a given file, and is suffixed
     * with a random token so a previous rejection of the same source is never overwritten.
     */
    static generateDlqObjectKey(sourceName: string) {
        const uniqueSuffix = randomBytes(4).readUInt32BE(0).toString(36).padStart(6, '0').slice(-6);
        return `${sourceName}-${uniqueSuffix}.json`;
    }

    /**
     * Persists a rejected datastore measurement into the configured DLQ bucket.
     * Failures to write are audited and swallowed, callers are still responsible
     * for rejecting the original request.
     */
    static async writeFailureToDatastoreDLQ(failedDocument, metadata: MeasurementFailureMetadata, dlqType: DlqType) {
        const Bucket = process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
        const sourceName =
            metadata?.orginalProcessedName || `${StandardMeasurementEntity.unknownDlqSourcePrefix}/${randomUUID()}`;
        const document = JSON.stringify({
            failedDocument,
            metadata: { ...metadata, orginalProcessedName: sourceName },
        });
        if (!Bucket) {
            StandardMeasurementEntity.logger.error('Failed to write to datastore dlq, no dlq bucket is configured');
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to write to DLQ',
                data: [{ failedDocument, metadata, dlqType }],
            });
            return;
        }
        try {
            for (let attempt = 0; attempt < 5; attempt++) {
                const Key = StandardMeasurementEntity.generateDlqObjectKey(sourceName);
                const written = await putDocumentWithoutOverwrite(document, Bucket, Key);
                if (written) {
                    StandardMeasurementEntity.logger.log(`Wrote failed measurement to dlq s3://${Bucket}/${Key}`);
                    return { Bucket, Key };
                }
                StandardMeasurementEntity.logger.warn(
                    `A document already exists at s3://${Bucket}/${Key}, generating a new dlq key`,
                );
            }
            throw new Error(`Unable to generate a unique dlq key for ${sourceName}`);
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
    }

    static async publishFailureToDLQ(failedDocument, metadata: MeasurementFailureMetadata, dlqType: DlqType) {
        if (dlqType !== DlqType.kafka) {
            return StandardMeasurementEntity.writeFailureToDatastoreDLQ(failedDocument, metadata, dlqType);
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
