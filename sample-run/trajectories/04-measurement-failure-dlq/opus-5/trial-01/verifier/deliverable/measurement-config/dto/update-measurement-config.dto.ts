import { BadRequestException } from '@nestjs/common';
import { ApiHideProperty, ApiProperty, getSchemaPath, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import { IsOptional, IsString, Matches, ValidateNested } from 'class-validator';
import { KafkaDeploymentParametersEntity } from '../../kubernetes-deployer/entities/kafkaConsumer/kafkaDeploymentParametersEntity.js';

import {
    AgentAccessInformation,
    DatastoreAccessInformation,
    InfrastructureAccessInformation,
    MeasurementConfigEntity,
} from '../entities/measurement-config.entity.js';
import { measurementMode } from './create-measurement-config.dto.js';

export class UpdateMeasurementConfigDto {
    /**
     * The unique ID for a measurement in MeteringCo
     */
    @IsString()
    @IsOptional()
    @ApiHideProperty()
    public measurementId: MeasurementConfigEntity['measurementId'];

    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     * @example 'My Cool Corp'
     *
     **/
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID: string;

    /**
     * A friendly, human-readable name of the measurement.
     */
    @IsString()
    @IsOptional()
    public measurementName: string;

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
    @IsOptional()
    @ApiProperty({ enum: measurementMode, isArray: false, example: 'infrastructure' })
    public measurementMode?: measurementMode;

    /**
     * Configuration for the measurement method.
     */
    @ApiProperty({
        type: 'object',

        oneOf: [
            { $ref: getSchemaPath('UpdateInfrastructureAccessInformation') },
            { $ref: getSchemaPath('UpdateAgentAccessInformation') },
            { $ref: getSchemaPath('UpdateDatastoreAccessInformation') },
        ],
    })
    @IsOptional()
    @ValidateNested({ each: true })
    @Type(({ object }) => {
        if (!object?.measurementMode) {
            throw new BadRequestException(
                'measurementMode must be provided, value must be either "infrastructure" or "agent" ',
            );
        }
        if (object.measurementMode.toLowerCase() === measurementMode.infrastructureBased.toLowerCase())
            return UpdateInfrastructureAccessInformation;
        else if (object.measurementMode.toLowerCase() === measurementMode.agentBased.toLowerCase())
            return UpdateAgentAccessInformation;
        else if (object.measurementMode.toLowerCase() === measurementMode.datastoreBased.toLowerCase())
            return UpdateDatastoreAccessInformation;
        // Handle edge case where the previous ifs are not fullfiled
    })
    public measurementConfiguration?: UpdateInfrastructureAccessInformation | UpdateAgentAccessInformation;
}

export class UpdateInfrastructureAccessInformation extends PartialType(InfrastructureAccessInformation) {}

export class UpdateAgentAccessInformation extends PartialType(AgentAccessInformation) {}

export class UpdateDatastoreAccessInformation extends PartialType(DatastoreAccessInformation) {
    @ApiProperty({})
    public consumerDeploymentParameters?: KafkaDeploymentParametersEntity;
}
