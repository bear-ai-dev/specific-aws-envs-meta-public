import fetch from 'cross-fetch';
import { ACCESS_TOKEN, API_BASE_URL, MAX_RETRY } from './init.js';
import { sleep } from '../../utils/utils.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/measurements';

export enum MeasurementMode {
    InfrastructureBased = 'infrastructureBased',
    AgentBased = 'agentBased',
    DatastoreBased = 'datastoreBased',
}

export enum CloudPlatform {
    aws = 'aws',
    azure = 'azure',
}

export enum ResourceType {
    EBSSnapshot = 'ebssnapshot',
    EBSVolume = 'ebs',
    EC2Instance = 'ec2',
    EC2Egress = 'ec2Egress',
}

export class MeasurementConfig {}

export class InfrastructureBasedMeasurementConfig extends MeasurementConfig {
    iamRoleArn: string;
    externalId: string;
    cloudPlatform: CloudPlatform;
    region: string;
    resourceType: ResourceType;
    constructor(
        iamRoleArn: string,
        externalId: string,
        cloudPlatform: CloudPlatform,
        region: string,
        resourceType: ResourceType
    ) {
        super();
        this.iamRoleArn = iamRoleArn;
        this.externalId = externalId;
        this.cloudPlatform = cloudPlatform;
        this.region = region;
        this.resourceType = resourceType;
    }
}

export enum DatastorePlatform {
    S3 = 's3',
    KAFKA = 'kafka',
}
export class KafkaDeploymentParameters {
    public securityMechanism?: string;
    public username?: string;
    public password?: string;
    public bootstrapServerEndpoint?: string;
    public topic: string;
    public dlqTopic: string;
}

export class DatastoreBasedMeasurementConfig extends MeasurementConfig {
    platform: DatastorePlatform;
    accountId?: string;
    consumerDeploymentParameters?: KafkaDeploymentParameters;

    constructor(
        platform: DatastorePlatform,
        accountId?: string,
        consumerDeploymentParameters?: KafkaDeploymentParameters
    ) {
        super();
        this.platform = platform;
        this.accountId = accountId;
        this.consumerDeploymentParameters = consumerDeploymentParameters;
    }
}

export abstract class Measurement {
    measurementName: string;
    measurementMode: MeasurementMode;
    measurementConfiguration: object;
    measurementId: string;
    constructor(id: string, mode: MeasurementMode = null, name: string = null, config: MeasurementConfig = null) {
        this.measurementName = name;
        this.measurementMode = mode;
        this.measurementConfiguration = config;
        this.measurementId = id;
    }

    abstract create({}): Promise<void>;
    abstract update(): Promise<any>;
    async delete(): Promise<void> {
        await this.deleteMeasurement();
    }
    async get(): Promise<Measurement> {
        return await this.getMeasurement();
    }

    async getAll(): Promise<any> {
        const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            return (await res.json()).data;
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }

    protected async putMeasurement(
        measurementMode: MeasurementMode,
        measurementName: string,
        measurementConfiguration: MeasurementConfig
    ): Promise<object> {
        return await this.writeMeasurement(
            measurementMode,
            measurementName,
            measurementConfiguration,
            'PUT',
            API_BASE_URL + RESOURCE_PATH + '/' + this.measurementId
        );
    }

    private async writeMeasurement(
        measurementMode: MeasurementMode,
        measurementName: string,
        measurementConfiguration: MeasurementConfig,
        method: string,
        url: string = API_BASE_URL + RESOURCE_PATH
    ): Promise<object> {
        const token = ACCESS_TOKEN;
        const res = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
                measurementName,
                measurementConfiguration,
                measurementMode,
            }),
        });
        if (res.status <= 201) {
            const body = await res.json();
            this.measurementName = measurementName;
            this.measurementConfiguration = measurementConfiguration;
            this.measurementMode = measurementMode;
            this.measurementId = body.measurementId;
            return body;
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }

    protected async postMeasurement(
        measurementMode: MeasurementMode,
        measurementName: string,
        measurementConfiguration: MeasurementConfig
    ): Promise<object> {
        return this.writeMeasurement(measurementMode, measurementName, measurementConfiguration, 'POST');
    }
    protected async getMeasurement(): Promise<Measurement> {
        if (!this.measurementId) {
            throw new Error('Measurement not initialized');
        }
        const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.measurementId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            const body = (await res.json()).data[0];
            this.measurementName = body.measurementName;
            this.measurementMode = body.measurementMode;
            this.measurementId = body.measurementId;
            switch (this.measurementMode) {
                case MeasurementMode.InfrastructureBased:
                    this.measurementConfiguration = new InfrastructureBasedMeasurementConfig(
                        body.measurementConfiguration.iamRoleArn,
                        body.measurementConfiguration.externalId,
                        body.measurementConfiguration.cloudPlatform,
                        body.measurementConfiguration.region,
                        body.measurementConfiguration.resourceType
                    );
                    break;
                case MeasurementMode.AgentBased:
                    // TODO
                    break;
                case MeasurementMode.DatastoreBased:
                    this.measurementConfiguration = new DatastoreBasedMeasurementConfig(
                        body.measurementConfiguration.platform,
                        body.measurementConfiguration.accountId
                    );
                    break;
                default:
                    break;
            }
            return this;
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }
    protected async deleteMeasurement(): Promise<void> {
        if (!this.measurementId) {
            throw new Error('Measurement not initialized');
        }
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.measurementId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                this.measurementName = null;
                this.measurementMode = null;
                this.measurementId = null;
                this.measurementConfiguration = null;
                return;
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
}

export abstract class InfrastructureBasedMeasurement extends Measurement {
    constructor(id: string = null, name: string = null, config: InfrastructureBasedMeasurementConfig = null) {
        super(id, MeasurementMode.InfrastructureBased, name, config);
    }
}

export class EC2InstanceTimeMeasurement extends InfrastructureBasedMeasurement {
    constructor(name: string = '', config: InfrastructureBasedMeasurementConfig = null, id: string = null) {
        super(id, name, config);
    }

    async create({ name, iamRoleArn, externalId, region }): Promise<void> {
        const newMeasurementConfiguration = new InfrastructureBasedMeasurementConfig(
            iamRoleArn,
            externalId,
            CloudPlatform.aws,
            region,
            ResourceType.EC2Instance
        );
        await this.postMeasurement(MeasurementMode.InfrastructureBased, name, newMeasurementConfiguration);
    }
    async update(): Promise<any> {
        throw new Error('Method not implemented.');
    }
}

export class EC2EgressMeasurement extends InfrastructureBasedMeasurement {
    constructor(name: string = '', config: InfrastructureBasedMeasurementConfig = null, id: string = null) {
        super(id, name, config);
    }

    async create({ name, iamRoleArn, externalId, region }): Promise<void> {
        const newMeasurementConfiguration = new InfrastructureBasedMeasurementConfig(
            iamRoleArn,
            externalId,
            CloudPlatform.aws,
            region,
            ResourceType.EC2Egress
        );
        await this.postMeasurement(MeasurementMode.InfrastructureBased, name, newMeasurementConfiguration);
    }
    async update(): Promise<any> {
        throw new Error('Method not implemented.');
    }
}

export abstract class DatastoreBasedMeasurement extends Measurement {
    constructor(id: string = null, name: string = null, config: DatastoreBasedMeasurementConfig) {
        super(id, MeasurementMode.DatastoreBased, name, config);
    }
}

export class UsageRecordInS3Measurement extends DatastoreBasedMeasurement {
    iamRoleArn: string;
    externalId: string;
    region: string;
    ingestion: string;
    dlq: string;
    constructor(id: string = null, name: string = '', config: DatastoreBasedMeasurementConfig = null) {
        super(id, name, config);
    }

    async create({ name, accountId }): Promise<void> {
        const newMeasurementConfiguration = new DatastoreBasedMeasurementConfig(DatastorePlatform.S3, accountId);
        const body = await this.postMeasurement(MeasurementMode.DatastoreBased, name, newMeasurementConfiguration);
        this.iamRoleArn = body['iamRoleArn'];
        this.externalId = body['externalId'];
        this.region = body['region'];
        this.ingestion = body['ingestion'];
        this.dlq = body['dlq'];
    }
    async update(accountId: string = null): Promise<any> {
        if (!accountId) {
            throw new Error('accountId is required to update measurement');
        }
        const newMeasurementConfiguration = new DatastoreBasedMeasurementConfig(DatastorePlatform.S3, accountId);
        const body = await this.putMeasurement(this.measurementMode, this.measurementName, newMeasurementConfiguration);
        this.iamRoleArn = body['iamRoleArn'];
        this.externalId = body['externalId'];
        this.region = body['region'];
        this.ingestion = body['ingestion'];
        this.dlq = body['dlq'];
    }
}

export class UsageRecordInKafkaMeasurement extends DatastoreBasedMeasurement {
    topic: string;
    dlq: string;
    constructor(id: string = null, name: string = '', config: DatastoreBasedMeasurementConfig = null) {
        super(id, name, config);
    }

    async create(): Promise<void> {
        const body = await this.postMeasurement(
            MeasurementMode.DatastoreBased,
            this.measurementName,
            this.measurementConfiguration
        );
        this.topic = body['topic'];
        this.dlq = body['dlq'];
    }
    async update(): Promise<any> {
        throw new Error('No updates for kafka datastore based measurement');
    }

    async delete(): Promise<void> {
        await super.deleteMeasurement();
    }
}
