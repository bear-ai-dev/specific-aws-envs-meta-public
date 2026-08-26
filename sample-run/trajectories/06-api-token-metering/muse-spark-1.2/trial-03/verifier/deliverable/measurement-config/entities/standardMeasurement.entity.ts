import { TokenConsumer } from '../../token-consumer/entities/token-consumer.entity.js';
import { TokenConsumerAsyncProcessor } from '../../token-consumer/token-consumer-async-processor.js';
import { TokenType } from '../../token-consumer/dto/TokenType.js';
import { Point } from '@influxdata/influxdb-client';
import { Tag } from '@aws-sdk/client-ec2';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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

const eventEmitter = new EventEmitter();
export enum DlqType {
    s3 = 's3',
    kafka = 'kafka',
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
            // Also record API call for platform metering (each measurement counts as one API call)
            try {
                const tenantBusinessID = (measurementFormat as any).businessID;
                if (tenantBusinessID) {
                    let customers: any[] = [];
                    try {
                        customers = await InfluxService.getMeteringCoCustomers();
                    } catch {}
                    let matched = customers.find((c: any) => {
                        try {
                            const meta = JSON.parse(c.metadata || '{}');
                            return meta.businessID === tenantBusinessID;
                        } catch { return false; }
                    });
                    if (!matched) {
                        matched = customers.find((c: any) => c.businessID === tenantBusinessID);
                    }
                    if (matched) {
                        const meteringcoCustomerId = matched.customerId;
                        const saasBusinessID = matched.businessID;
                        let dimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                        if (saasBusinessID === 'meteringco-sandbox') dimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                        try {
                            if ((matched as any).offeringId) {
                                const { dimensions } = await InfluxService.getMeteringCoOffering((matched as any).offeringId);
                                if (dimensions && dimensions.length) {
                                    const apiDim: any = dimensions.find((d: any) => d.dimensionName && String(d.dimensionName).toLowerCase().includes('api')) || dimensions[0];
                                    dimensionId = apiDim.dimensionId || dimensionId;
                                }
                            }
                        } catch {}
                        const uuid = randomUUID();
                        const tokenPoint = new Point(TokenConsumer._measurement)
                            .tag('customerId', meteringcoCustomerId)
                            .tag('businessID', saasBusinessID)
                            .tag('dimensionId', dimensionId)
                            .tag('metadata_tokenType', JSON.stringify(TokenType.apiCall))
                            .tag('metadata_uuid', JSON.stringify(uuid))
                            .floatField('recordValue', 0.001)
                            .timestamp(new Date((measurementFormat as any).timestamp || new Date().toISOString()));
                        void influxService.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, (influxService as any).org, [tokenPoint], false);
                    }
                }
            } catch (e) {
                AuditService.publishEvent({ data: [e], message: 'Failed to meter API call for measurement', topic: AuditScope.ERROR });
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
            const s3 = new S3Client({ region: 'us-east-1' });
            const params = {
                Bucket: process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME,
                Key: `${metadata.orginalProcessedName}-${(Math.random() + 1).toString(36).substring(7)}.json`,
                Body: JSON.stringify({ failedDocument: failedDocument, metadata }),
            };
            try {
                await s3.send(new PutObjectCommand(params));
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

    constructor({ timestamp, results, businessID, measurementId }: MeasurementFailureMetadata) {
        this.timestamp = timestamp;
        this.results = results;
        this.businessID = businessID;
        this.measurementId = measurementId;
    }
}
