import { Point } from '@influxdata/influxdb-client';
import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ApiHideProperty, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import {
    IsArray,
    IsEnum,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Matches,
    ValidateNested,
    ValidationArguments,
} from 'class-validator';
import { Type } from 'class-transformer';

import { InfluxService } from '../../influx/influx.service.js';
import { CreateUserDto } from '../../users/dto/create-user.dto.js';
import { measurementMode } from '../dto/create-measurement-config.dto.js';
import { ValidIAMRole } from '../../setting/dto/customIAMAuthorizer.js';
import { IAM } from '@aws-sdk/client-iam';
import { randomUUID } from 'crypto';
import { KafkaDeploymentParametersEntity } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaDeploymentParametersEntity.js';
import { KafkaDeploymentParametersDto } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaDeploymentParametersDto.js';
import { KubernetesDeployerService } from '../../kubernetes-deployer/kubernetes-deployer.service.js';
import { DeploymentType } from '../../kubernetes-deployer/dto/DeploymentType.js';
import { KubernetesManager } from '../../kubernetes-deployer/entities/kubernetes-deployer.entity.js';
import { KafkaManager } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaClient.entity.js';
import { retry } from 'rxjs';

/**
 * @author Developer One <developer.one@meteringco.example>
 *
 * @enum The list of supported cloud platforms
 * @example "AWS"
 */
export enum supportedCloudPlatforms {
    aws = 'aws',
}
export enum SupportedResources {
    ebssnapshot = 'ebssnapshot',
    ebs = 'ebs',
    k8sPod = 'k8spod',
    ec2 = 'ec2',
    /**
     * The outbound network traffic (egress) of a customers EC2 instances, measured in bytes
     */
    ec2NetworkOut = 'ec2networkout',
    /**
     * For internal use only
     */
    usageData = 'usageData',
}
export enum SupportedAgentHostingPlatforms {
    eks = 'k8spod',
}

export class IAMAccessCredentials {
    /**
     * The IAM role created by SaaS business and can be by MeteringCo AWS account to measure usage.
     * <br><br>
     * Example `"arn:aws:iam::123456789012:role/meteringco-scraper"`
     * @example "arn:aws:iam::123456789012:role/meteringco-scraper"
     */
    @ValidIAMRole('externalId', {
        message: 'Unable to authenticate with the IAM role and External ID provided. Please double check',
    })
    @IsNotEmpty()
    @ApiProperty()
    public iamRoleArn: string;

    /**
     * The Optional ExternalId associated with the IAM role.
     * <br><br>
     * Example `"123456789"`
     * @example "123456789"
     */
    @IsString()
    @IsOptional()
    @ApiProperty({
        externalDocs: {
            description: 'Read more about why externalIds are important',
            url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html',
        },
    })
    public externalId?: string;

    constructor(access) {
        if (access) {
            const { iamRoleArn, externalId } = access;
            this.externalId = externalId;
            this.iamRoleArn = iamRoleArn;
        }
    }
}

/**
 * @author Developer One <developer.one@meteringco.example>
 *
 * @enum The list of Supported AWS resources
 * @example "EBS"
 */

export class MeasurementConfigEntity {
    @ApiHideProperty()
    public static _measurement = 'MeasurementConfiguration';

    /**
     * The measurement method.
     * See <a href="https://docs.meteringco.example/measure-usage-and-collect-data/measure-and-collect-usage-data-at-production-scale">Measure and Collect Usage Data at Production Scale</a> for more information.
     * <br><br>
     * Example `"agentBased"`
     */
    public measurementMode: measurementMode;

    /**
     * Unique identifier assigned by MeteringCo.
     * <br><br>
     * Example `"de388932-a7e1-11ed-afa1-0242ac120002"`
     * @example  "de388932-a7e1-11ed-afa1-0242ac120002"
     */
    @ApiProperty()
    public measurementId: string;

    /**
     * Configurations of the measurement
     */
    public measurementConfiguration:
        | InfrastructureAccessInformation
        | AgentAccessInformation
        | DatastoreAccessInformation;

    @IsString()
    @IsOptional()
    @ApiHideProperty()
    public businessID?: string;

    /**
     * The subject associated with the user
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public subject: CreateUserDto['subject'];

    /**
     * The value indicating if a measurement configuration is soft deleted
     * */
    @ApiHideProperty()
    public softDelete?: boolean;

    /***
     * The human readable name of the measurement
     *  <br><br>
     * Example `"EBS Usage"`
     * @example "EBS Usage"
     */
    @ApiProperty()
    public measurementName?: string;
    constructor({
        measurementMode: argumentMeasurementMode,
        measurementConfiguration,
        measurementId,
        businessID,
        measurementName,
        subject,
    }: MeasurementConfigEntity) {
        this.measurementMode = argumentMeasurementMode;
        if (argumentMeasurementMode.toLowerCase() === measurementMode.infrastructureBased.toLowerCase()) {
            this.measurementConfiguration = new InfrastructureAccessInformation(
                measurementConfiguration as InfrastructureAccessInformation,
            );
        } else if (argumentMeasurementMode.toLowerCase() === measurementMode.agentBased.toLowerCase()) {
            this.measurementConfiguration = new AgentAccessInformation(
                measurementConfiguration as AgentAccessInformation,
            );
        } else if (argumentMeasurementMode.toLowerCase() === measurementMode.datastoreBased.toLowerCase()) {
            this.measurementConfiguration = new DatastoreAccessInformation({
                ...measurementConfiguration,
            } as DatastoreAccessInformation);
        }
        this.measurementId = measurementId;
        this.businessID = businessID;
        this.subject = subject;
        this.measurementName = measurementName;
    }

    static transformer(measurementConfigEntity: MeasurementConfigEntity, influxService: InfluxService): Array<Point> {
        const measurementConfigEntityPoint = influxService.getPoint(MeasurementConfigEntity._measurement);
        const {
            measurementMode: argumentMeasurementMode,
            measurementConfiguration,
            measurementId,
            businessID,
            subject,
            softDelete,
            measurementName,
        } = measurementConfigEntity;

        measurementConfigEntityPoint.stringField('measurementMode', argumentMeasurementMode);
        measurementConfigEntityPoint.tag('measurementId', measurementId);

        measurementConfigEntityPoint.tag('businessID', businessID);
        measurementConfigEntityPoint.tag('subject', subject);
        measurementConfigEntityPoint.tag('measurementName', measurementName);
        if (softDelete) {
            measurementConfigEntityPoint.tag('softDelete', 'deleted');
        }
        if (argumentMeasurementMode.toLowerCase() === measurementMode.infrastructureBased.toLowerCase()) {
            const completedPoint = InfrastructureAccessInformation.transformer(
                measurementConfiguration as InfrastructureAccessInformation,
                measurementConfigEntityPoint,
            );

            return [completedPoint];
        } else if (argumentMeasurementMode.toLowerCase() === measurementMode.agentBased.toLowerCase()) {
            const completedPoint = AgentAccessInformation.transformer(
                measurementConfiguration as AgentAccessInformation,
                measurementConfigEntityPoint,
            );

            return [completedPoint];
        } else if (argumentMeasurementMode.toLowerCase() === measurementMode.datastoreBased.toLowerCase()) {
            console.log('DB  transformer', measurementConfiguration);
            const completedPoint = DatastoreAccessInformation.transformer(
                measurementConfiguration as DatastoreAccessInformation,
                measurementConfigEntityPoint,
            );

            return [completedPoint];
        } else {
            throw new InternalServerErrorException('Failed to Create Entity and store Measurmenent in DB');
        }
    }
    static dbModelToEntity({
        measurementId,
        _value,
        businessID,
        measurementName,
        subject,
        ...rest
    }: {
        [x: string]: any;
    }) {
        if (_value && _value.toLowerCase() === measurementMode.infrastructureBased.toLowerCase()) {
            const infrastructureAccessInformation = InfrastructureAccessInformation.dbModelToEntity({ ...rest });

            return new MeasurementConfigEntity({
                measurementId,
                measurementMode: _value,
                businessID,
                measurementConfiguration: infrastructureAccessInformation,
                subject,
                measurementName,
            });
        } else if (_value && _value.toLowerCase() === measurementMode.agentBased.toLowerCase()) {
            const agentAccessInformation = AgentAccessInformation.dbModelToEntity({
                ...rest,
            });
            return new MeasurementConfigEntity({
                measurementId,
                measurementMode: _value,
                businessID,
                measurementConfiguration: agentAccessInformation,
                subject,
                measurementName,
            });
        } else if (_value && _value.toLowerCase() === measurementMode.datastoreBased.toLowerCase()) {
            const dbAccessInformation = DatastoreAccessInformation.dbModelToEntity({
                ...rest,
            });
            return new MeasurementConfigEntity({
                measurementId,
                measurementMode: _value,
                businessID,
                measurementConfiguration: dbAccessInformation,
                subject,
                measurementName,
            });
        }
    }

    static async setupAccessIfRequired(
        measurementConfig: MeasurementConfigEntity,
    ): Promise<{ iamRoleArn: string; externalId: string; dlq: string; ingestion: string } | any> {
        console.log('Setting up access', measurementConfig.measurementMode);
        if (measurementConfig.measurementMode.toLowerCase() === measurementMode.datastoreBased.toLowerCase()) {
            return DatastoreAccessInformation.setupAccess(measurementConfig);
        } else {
            return Promise.resolve();
        }
    }
    static async removeAccessIfRequired(
        measurementConfig: MeasurementConfigEntity,
    ): Promise<{ iamRoleArn: string; externalId: string; dlq: string; ingestion: string } | any> {
        if (measurementConfig.measurementMode.toLowerCase() === measurementMode.datastoreBased.toLowerCase()) {
            return DatastoreAccessInformation.removeAccess(measurementConfig);
        } else {
            return Promise.resolve();
        }
    }
    static async updateAccessIfRequired(
        updatedMeasurementConfig: MeasurementConfigEntity,
        oldMeasurementConfig: MeasurementConfigEntity,
    ): Promise<{ iamRoleArn: string; externalId: string; dlq: string; ingestion: string } | any> {
        if (updatedMeasurementConfig.measurementMode.toLowerCase() === measurementMode.datastoreBased.toLowerCase()) {
            const oldDataStoreMeasurement =
                oldMeasurementConfig?.measurementConfiguration as DatastoreAccessInformation;
            const newDataStoreMeasurement =
                updatedMeasurementConfig?.measurementConfiguration as DatastoreAccessInformation;
            if (
                oldDataStoreMeasurement?.platform === SupportedDatastores.s3 &&
                newDataStoreMeasurement?.accountId !== oldDataStoreMeasurement?.accountId
            ) {
                return DatastoreAccessInformation.updateAccess(updatedMeasurementConfig);
            }
            if (
                oldDataStoreMeasurement?.platform === SupportedDatastores.kafka &&
                newDataStoreMeasurement?.consumerDeploymentParameters &&
                Object.keys(newDataStoreMeasurement?.consumerDeploymentParameters).length > 0
            ) {
                return DatastoreAccessInformation.updateAccess(updatedMeasurementConfig);
            }
        } else {
            return Promise.resolve();
        }
    }
}

export class MeteringCoFilters {
    /**
     *
     * The string containing the key associated with a metadata tag.
     * This could be an tag on AWS infrastructure, or a label on a kubernetes pod
     */
    @IsString()
    @IsNotEmpty()
    public key: string;
    /**
     *
     * The string containing the value associated with a metadata tag.
     * This could be an tag on AWS infrastructure, or a label on a kubernetes pod
     */
    @IsArray()
    @IsNotEmpty()
    public values: Array<string>;
}
export class InfrastructureAccessInformation extends IAMAccessCredentials {
    /**
     * Cloud infrastructure platform
     *
     * Example `"aws"`
     * @example "aws"
     */
    @Matches(
        `^${Object.values(supportedCloudPlatforms)
            .filter((v) => typeof v !== 'number')
            .join('|')}$`,
        'i',
    )
    @IsNotEmpty()
    @ApiProperty({
        enum: supportedCloudPlatforms,
        isArray: false,
        example: 'aws',
        description: 'Cloud infrastructure platform <br><br> Example `"aws"`',
    })
    public cloudPlatform: supportedCloudPlatforms;

    /**
     *
     * Supported region of the infrastructure
     *
     * Example `"us-east-1"`
     * @example "us-east-1"
     */
    @IsString()
    @IsNotEmpty()
    @ApiProperty()
    public region: string;

    /**
     * Underlying resource type which MeteringCo measures usage for.
     * This could be an AWS EC2 instance, or a EBS volume.
     *
     * Example `"ec2"`
     * @example "ec2"
     */
    @Matches(
        `^${Object.values(SupportedResources)
            .filter((v) => typeof v !== 'number')
            .join('|')}$`,
        'i',
    )
    @ApiProperty({
        enum: SupportedResources,
        isArray: false,
        example: 'ebs',
        description: 'Underlying resource type which MeteringCo measures usage for. <br><br> Example `"ec2"`',
    })
    public resourceType: SupportedResources;

    constructor(accessInfo) {
        super({ ...accessInfo });
        if (accessInfo) {
            const { cloudPlatform, region, resourceType } = accessInfo;
            this.cloudPlatform = cloudPlatform;

            this.region = region;
            this.resourceType = resourceType;
        }
    }
    public static transformer(
        infrastructureAccessInformation: InfrastructureAccessInformation,
        influxPoint: Point,
    ): Point {
        if (infrastructureAccessInformation) {
            const { iamRoleArn, externalId } = infrastructureAccessInformation;

            influxPoint.tag('iamRoleArn', iamRoleArn);
            if (externalId) {
                influxPoint.tag('externalId', externalId);
            }

            influxPoint.tag('cloudPlatform', infrastructureAccessInformation.cloudPlatform.toLowerCase());
            influxPoint.tag('region', infrastructureAccessInformation.region);
            if (infrastructureAccessInformation.resourceType) {
                influxPoint.tag('resourceType', infrastructureAccessInformation.resourceType.toLowerCase());
            }

            return influxPoint;
        }
    }

    public static dbModelToEntity({
        cloudPlatform,
        region,
        resourceType,
        iamRoleArn,
        externalId = '',
    }: {
        [x: string]: any;
    }) {
        return new InfrastructureAccessInformation({
            cloudPlatform: cloudPlatform.toLowerCase(),
            region,
            resourceType: resourceType,
            iamRoleArn,
            externalId,
        });
    }
}
export enum SupportedDatastores {
    s3 = 's3',
    kafka = 'kafka',
}
/**
 *
 * This Class represents the access information and control data structure for Datastore based Measurement solutions
 * Specifically this is the access information needed for connectors inside of Confluent Cloud to pull data from a clients env.
 * There are many different connectors with different access and control needs.
 * For example a MySQL connector is not the same as a Kinesis Connector
 * */
export class DatastoreAccessInformation {
    /**
     * Underlying resource type which meteringco connects to.
     *
     */
    @IsEnum(SupportedDatastores, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `platform: The value ${value} is not a valid value for the platform field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @ApiProperty({
        enum: SupportedDatastores,
        isArray: false,
        required: true,
        examples: ['s3'],
        description: 'Underlying resource type which meteringco connects to. <br><br> Example `"s3"`',
    })
    public platform?: SupportedDatastores;

    /**
     * The Unqiue ID for your cloud account.
     * <br><br>
     * Example `"111122223333"`
     * @example "111122223333"
     */
    @IsString()
    @IsOptional()
    public accountId?: string;
    /**
     * The access information and configuration for deploying a datastore consumer by MeteringCo. Use this field in a case where MeteringCo is deploying a consumer and you want to provide the access information for the datastore.
     */
    @ApiProperty({
        type: 'object',

        oneOf: [{ $ref: getSchemaPath('KafkaDeploymentParametersDto') }],
    })
    @IsOptional()
    @IsObject()
    @ValidateNested({ each: true })
    @Type(({ object }) => {
        if (object?.platform?.toLowerCase() === SupportedDatastores.kafka.toLowerCase())
            return KafkaDeploymentParametersDto;
    })
    public consumerDeploymentParameters?: KafkaDeploymentParametersDto;

    @ApiHideProperty()
    public ingestion: string;
    @ApiHideProperty()
    public dlq: string;
    @ApiHideProperty()
    public iamRoleArn?: string;
    @ApiHideProperty()
    public externalId?: string;
    @ApiHideProperty()
    public region?: string;

    constructor(datastoreAccessInformation: DatastoreAccessInformation) {
        if (datastoreAccessInformation) {
            const {
                accountId,
                platform,
                dlq,
                ingestion,
                iamRoleArn,
                externalId,
                region,
                consumerDeploymentParameters,
            } = datastoreAccessInformation;
            this.platform = platform ? platform : SupportedDatastores.s3;
            if (platform === SupportedDatastores.kafka) {
                this.consumerDeploymentParameters = consumerDeploymentParameters;
            } else {
                this.accountId = accountId;
                this.dlq = dlq;
                this.ingestion = ingestion;
                this.iamRoleArn = iamRoleArn;
                this.externalId = externalId;
                this.region = region ? region : 'us-east-1';
            }
        }
    }

    public static transformer(datastoreAccessInformation: DatastoreAccessInformation, influxPoint: Point) {
        if (datastoreAccessInformation) {
            const {
                platform,
                accountId,
                dlq,
                ingestion,
                iamRoleArn,
                externalId,
                region,
                consumerDeploymentParameters,
            } = datastoreAccessInformation;
            if (platform) influxPoint.tag('platform', platform);
            if (accountId) influxPoint.tag('accountId', accountId);
            if (platform === SupportedDatastores.kafka) {
                KafkaDeploymentParametersEntity.transformer(consumerDeploymentParameters, influxPoint);
            } else {
                if (dlq) influxPoint.tag('dlq', dlq);
                if (ingestion) influxPoint.tag('ingestion', ingestion);
            }
            if (iamRoleArn) influxPoint.tag('iamRoleArn', iamRoleArn);
            if (externalId) influxPoint.tag('externalId', externalId);
            if (region) influxPoint.tag('region', region);
        }
        return influxPoint;
    }

    public static dbModelToEntity({
        iamRoleArn,
        platform,
        accountId,
        externalId,
        dlq,
        ingestion,
        region,
        topic,
        dlqTopic,
    }: {
        [x: string]: any;
    }) {
        let consumerDeploymentParameters;
        if (platform === SupportedDatastores.kafka) {
            consumerDeploymentParameters = KafkaDeploymentParametersEntity.dbModelToEntity({
                topic,
                dlqTopic,
            });
        }
        return new DatastoreAccessInformation({
            platform,
            accountId,
            dlq,
            ingestion,
            externalId,
            iamRoleArn,
            region,
            consumerDeploymentParameters,
        });
    }
    public static async setupAccess(MeasurementConfigEntity: MeasurementConfigEntity) {
        const { measurementConfiguration, businessID, measurementId } = MeasurementConfigEntity;
        const { platform, accountId, consumerDeploymentParameters } =
            measurementConfiguration as DatastoreAccessInformation;
        console.log(JSON.stringify(measurementConfiguration, null, 2), 'measurementConfiguration');
        if (platform === SupportedDatastores.s3) {
            const externalId = randomUUID();
            // Create a new IAM role for the business with the measurementId in the name
            // It will use the following Policy ARN: arn:aws:iam::123456789012:policy/datastore-measurement-policy
            // The trust policy will enable their account to assume the role and the policy will allow them to access the bucket
            // The cloudId is their AWS accountId
            const iam = new IAM({ region: 'us-east-1' });
            // Create the Policy
            const policyParams = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Sid: 'VisualEditor0',
                        Effect: 'Allow',
                        Action: [
                            's3:PutObject',
                            's3:GetObject',
                            's3:DeleteObject',
                            's3:GetBucketLocation',
                            's3:GetObjectVersion',
                            's3:ListBucket',
                        ],
                        Resource: [
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_BUCKET_NAME}/*`,
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}/*`,
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_BUCKET_NAME}/`,
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}/`,
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_BUCKET_NAME}`,
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}`,
                        ],
                        Condition: {
                            StringLike: {
                                's3:prefix': `${businessID}/*`,
                            },
                        },
                    },
                    {
                        Sid: 'VisualEditor1',
                        Effect: 'Allow',
                        Action: [
                            's3:PutObject',
                            's3:GetObject',
                            's3:DeleteObject',
                            's3:GetBucketLocation',
                            's3:GetObjectVersion',
                            's3:ListBucket',
                        ],
                        Resource: [
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_BUCKET_NAME}/${businessID}/*`,
                            `arn:aws:s3:::${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}/${businessID}/*`,
                        ],
                    },
                ],
            };

            const policy = await iam.createPolicy({
                PolicyName: `datastore-${businessID}-${measurementId}`,
                PolicyDocument: JSON.stringify(policyParams),
            });
            const roleParams = {
                RoleName: `datastore-${businessID}-${measurementId}`,
                Permissions: {},
                AssumeRolePolicyDocument: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: {
                                AWS: `arn:aws:iam::${accountId}:root`,
                            },
                            Action: 'sts:AssumeRole',
                            Condition: {
                                StringEquals: {
                                    'sts:ExternalId': `${externalId}`,
                                },
                            },
                        },
                    ],
                }),
            };
            try {
                const res = await iam.createRole(roleParams);

                // Attach policy to role
                await iam.attachRolePolicy({
                    PolicyArn: policy.Policy.Arn,
                    RoleName: `datastore-${businessID}-${measurementId}`,
                });

                // Return the role arn
                return {
                    iamRoleArn: res.Role.Arn,
                    externalId,
                    dlq: `s3://${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}/${businessID}`,
                    ingestion: `s3://${process.env.DB_MEASUREMENT_BUCKET_NAME}/${businessID}`,
                    region: 'us-east-1',
                };
            } catch (e) {
                if (e?.Error?.Code === 'MalformedPolicyDocument') {
                    throw new BadRequestException(`The provided accountId: ${accountId} is not valid`);
                }
                throw e;
            }
        }
        if (platform === SupportedDatastores.kafka) {
            const k8sService = new KubernetesDeployerService();
            const kafkaConsumerDeploymentParameters = consumerDeploymentParameters as KafkaDeploymentParametersDto;
            try {
                const client = await KafkaManager.initalizeClient(
                    //eslint-disable-next-line
                    // @ts-ignore
                    new KafkaManager({ ...kafkaConsumerDeploymentParameters, clientId: measurementId }),
                );
                const consumer = client.consumer({ groupId: 'test-url', retry: { retries: 2 } });
                await consumer.connect();
                await consumer.disconnect();
                const producer = client.producer();
                await producer.connect();
                await producer.disconnect();
                await k8sService.create({
                    uniqueId: measurementId,
                    businessID,
                    deploymentType: DeploymentType.kafkaConsumer,
                    deploymentParameters: kafkaConsumerDeploymentParameters,
                });
            } catch (e) {
                console.log(e, 'error');
                throw new BadRequestException(
                    `Could not establish a consumer and producer connection to kafka with the parameters provided. Password is removed from error response.  ${JSON.stringify(
                        {
                            ...kafkaConsumerDeploymentParameters,
                            password: '***',
                        },
                    )}`,
                );
            }
        }
    }
    public static async updateAccess(MeasurementConfigEntity: MeasurementConfigEntity) {
        const { measurementConfiguration, businessID, measurementId } = MeasurementConfigEntity;

        const { platform, accountId, externalId, iamRoleArn, consumerDeploymentParameters } =
            measurementConfiguration as DatastoreAccessInformation;

        if (platform === SupportedDatastores.s3) {
            // Get the current Role for a business: datastore-${businessID}-${measurementId}
            // Change the Statement[0] on the role to the new accountId, reuse the externalId on the role
            const iam = new IAM({ region: 'us-east-1' });
            const roleParams = {
                RoleName: `datastore-${businessID}-${measurementId}`,
                PolicyDocument: JSON.stringify({
                    Version: '2012-10-17',
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: {
                                AWS: `arn:aws:iam::${accountId}:root`,
                            },
                            Action: 'sts:AssumeRole',
                            Condition: {
                                StringEquals: {
                                    'sts:ExternalId': `${externalId}`,
                                },
                            },
                        },
                    ],
                }),
            };
            try {
                await iam.updateAssumeRolePolicy(roleParams);

                // Return the role arn and additional information
                return {
                    iamRoleArn,
                    externalId,
                    dlq: `s3://${process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME}/${businessID}`,
                    ingestion: `s3://${process.env.DB_MEASUREMENT_BUCKET_NAME}/${businessID}`,
                    region: 'us-east-1',
                };
            } catch (e) {
                if (e?.Error?.Code === 'MalformedPolicyDocument') {
                    throw new BadRequestException(`The provided accountId: ${accountId} is not valid`);
                }
                throw e;
            }
        }
        if (platform === SupportedDatastores.kafka) {
            const k8sService = new KubernetesDeployerService();
            const kafkaConsumerDeploymentParameters = consumerDeploymentParameters as KafkaDeploymentParametersEntity;
            await k8sService.delete({
                kubernetesManager: new KubernetesManager({
                    deploymentType: DeploymentType.kafkaConsumer,
                    uniqueId: measurementId,
                    businessID,
                    deploymentParameters: kafkaConsumerDeploymentParameters,
                }),
            });
            await k8sService.create({
                uniqueId: measurementId,
                businessID,
                deploymentType: DeploymentType.kafkaConsumer,
                deploymentParameters: kafkaConsumerDeploymentParameters,
            });
        }
    }

    public static async removeAccess(MeasurementConfigEntity: MeasurementConfigEntity) {
        const { measurementConfiguration, businessID, measurementId } = MeasurementConfigEntity;

        const { platform, consumerDeploymentParameters } = measurementConfiguration as DatastoreAccessInformation;

        if (platform === SupportedDatastores.s3) {
            // Get the current Role for a business: datastore-${businessID}-${measurementId}
            // Change the Statement[0] on the role to the new accountId, reuse the externalId on the role
            const iam = new IAM({ region: 'us-east-1' });
            const roleParams = {
                RoleName: `datastore-${businessID}-${measurementId}`,
            };
            try {
                await iam.deleteRole(roleParams);
            } catch (e) {
                throw e;
            }
        }
        console.log(platform, 'platform');
        if (platform === SupportedDatastores.kafka) {
            const k8sService = new KubernetesDeployerService();
            const kafkaConsumerDeploymentParameters = consumerDeploymentParameters as KafkaDeploymentParametersEntity;
            await k8sService.delete({
                kubernetesManager: new KubernetesManager({
                    deploymentType: DeploymentType.kafkaConsumer,
                    uniqueId: measurementId,
                    businessID,
                    deploymentParameters: kafkaConsumerDeploymentParameters,
                }),
            });
        }
    }
}

export class AgentAccessInformation extends IAMAccessCredentials {
    /**
     * Hosting platform of SaaS application
     *
     */
    @Matches(
        `^${Object.values(SupportedAgentHostingPlatforms)
            .filter((v) => typeof v !== 'number')
            .join('|')}$`,
        'i',
    )
    @IsNotEmpty()
    @ApiProperty({
        enum: SupportedAgentHostingPlatforms,
        isArray: false,
        example: 'k8spod',
        description: 'Hosting platform of SaaS application',
    })
    public hostingPlatform: SupportedAgentHostingPlatforms;

    constructor(agentAccessInformation: AgentAccessInformation) {
        super({ ...agentAccessInformation });
        if (agentAccessInformation) {
            const { iamRoleArn, externalId, hostingPlatform } = agentAccessInformation;
            this.iamRoleArn = iamRoleArn;
            this.externalId = externalId;
            this.hostingPlatform = hostingPlatform;
        }
    }

    public static transformer(agentAccessInformation: AgentAccessInformation, influxPoint: Point): Point {
        if (agentAccessInformation) {
            const { iamRoleArn, externalId, hostingPlatform } = agentAccessInformation;

            influxPoint.tag('iamRoleArn', iamRoleArn);
            if (externalId) {
                influxPoint.tag('externalId', externalId);
            }
            if (hostingPlatform) {
                influxPoint.tag('hostingPlatform', hostingPlatform.toLowerCase());
            } else {
                influxPoint.tag('hostingPlatform', '');
            }

            return influxPoint;
        }
        return influxPoint;
    }

    public static dbModelToEntity({ iamRoleArn, externalId = '', hostingPlatform }: { [x: string]: any }) {
        let parsedHostingPlatform;
        if (hostingPlatform) {
            parsedHostingPlatform = hostingPlatform.toLowerCase();
        }
        return new AgentAccessInformation({
            iamRoleArn,
            externalId,
            hostingPlatform: parsedHostingPlatform,
        });
    }
}

export class APIAccessInformation {
    public static transformer(aPIAccessInformation: APIAccessInformation, influxPoint: Point): Point {
        return influxPoint;
    }
}
