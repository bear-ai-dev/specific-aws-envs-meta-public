import { BadRequestException } from '@nestjs/common';
import { ApiHideProperty, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsString,
    IsOptional,
    IsNotEmpty,
    ValidateNested,
    IsDefined,
    IsNotEmptyObject,
    IsObject,
    Matches,
} from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { KafkaDeploymentParametersEntity } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaDeploymentParametersEntity.js';
import {
    MeasurementConfigEntity,
    InfrastructureAccessInformation,
    AgentAccessInformation,
    DatastoreAccessInformation,
} from '../entities/measurement-config.entity.js';

/**
 *
 * @enum The current list of supported measurement modes.
 * Currently some modes like API/Agent require out of meteringco-backend requirements to be fulfilled.
 * Like the deployment of the Agent.
 *
 * @example "agentBased"
 * @example "infrastructureBased"
 */
export enum measurementMode {
    infrastructureBased = 'infrastructureBased',
    agentBased = 'agentBased',
    datastoreBased = 'datastoreBased',
}

export class CreateMeasurementConfigDto {
    /**
     * The measurement method.
     * See <a href="https://docs.meteringco.example/measure-usage-and-collect-data/measure-and-collect-usage-data-at-production-scale">Measure and Collect Usage Data at Production Scale</a> for more information.
     * <br><br>
     * Example `"agentBased"`
     */
    @Matches(
        `^${Object.values(measurementMode)
            .filter((v) => typeof v !== 'number')
            .join('|')}$`,
        'i',
    )
    @IsNotEmpty()
    @ApiProperty({
        enum: measurementMode,
        isArray: false,
        example: 'infrastructureBased',
        description:
            'The measurement method. See <a href="https://docs.meteringco.example/measure-usage-and-collect-data/measure-and-collect-usage-data-at-production-scale">Measure and Collect Usage Data at Production Scale</a> for more information. <br><br> Example `"agentBased"`',
    })
    public measurementMode: measurementMode;

    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     * @example 'My Cool Corp'
     *
     **/
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * Configuration for the measurement method.
     */
    @ApiProperty({
        type: 'object',

        oneOf: [
            { $ref: getSchemaPath('InfrastructureAccessInformation') },
            { $ref: getSchemaPath('AgentAccessInformation') },
            { $ref: getSchemaPath('DatastoreAccessInformation') },
        ],
    })
    @IsDefined()
    @IsNotEmptyObject()
    @IsObject()
    @ValidateNested({ each: true })
    @Type(({ object }) => {
        if (!object?.measurementMode) {
            throw new BadRequestException(
                'measurementMode must be provided, value must be either "infrastructure" or "agent" ',
            );
        }
        if (object.measurementMode.toLowerCase() === measurementMode.infrastructureBased.toLowerCase())
            return InfrastructureAccessInformation;
        else if (object.measurementMode.toLowerCase() === measurementMode.agentBased.toLowerCase())
            return AgentAccessInformation;
        else if (object.measurementMode.toLowerCase() === measurementMode.datastoreBased.toLowerCase())
            return DatastoreAccessInformation;

        // Handle edge case where the previous ifs are not fullfiled
    })
    public measurementConfiguration:
        | InfrastructureAccessInformation
        | AgentAccessInformation
        | DatastoreAccessInformation;

    /**
     * The human readable name of the measurement
     *  <br><br>
     * Example `"EBS Usage"`
     * @example "EBS Usage"
     **/
    @IsString()
    @IsOptional()
    @ApiProperty()
    public measurementName?: string;
}

export class CreateMeasurementConfigurationResponse extends BasicResponseDTO {
    /**
     * Unique identifier assigned by MeteringCo
     * <br><br>
     * Example: `"a65ae317-e940-44cc-b570-cc74d1897c36"`
     * @example "a65ae317-e940-44cc-b570-cc74d1897c36"
     */
    public measurementId: MeasurementConfigEntity['measurementId'];

    /**
     * The IAM role which can be assumed to pass data on a MeteringCo-hosted datastore.
     * <br><br>
     * Example: `"arn:aws:iam::123456789012:role/meteringco-datastore-role"`
     * @example "arn:aws:iam::123456789012:role/meteringco-datastore-role"
     */
    public iamRoleArn?: string;

    /**
     * The externalId to be used with the IAM role.
     * <br><br>
     * Example: `"1234567890abc"`
     * @example "1234567890abc"
     *
     */
    @ApiProperty({
        externalDocs: {
            description: 'Read more about why externalIds are important',
            url: 'https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_create_for-user_externalid.html',
        },
    })
    public externalId?: string;

    /**
     * The URL of the ingestion endpoint associated with the datastore measurement
     * <br><br>
     * Example: `"s3://meteringco-datastore-dump-bucket/"`
     * @example 's3://meteringco-datastore-dump-bucket/'
     **/
    public ingestion?: string;
    /**
     * The URL of the DLQ endpoint associated with the datastore measurement
     * <br><br>
     * Example: `"s3://meteringco-datastore-dlq-bucket/"`
     * @example 's3://meteringco-datastore-dlq-bucket/'
     **/
    public dlq?: string;
}
