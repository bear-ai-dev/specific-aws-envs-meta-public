import { BadRequestException } from '@nestjs/common';
import { ApiHideProperty, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsDefined,
    IsEnum,
    IsNotEmptyObject,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested,
    ValidationArguments,
} from 'class-validator';
import { KafkaDeploymentParametersDto } from '../entities/kafkaConsumer/kafkaDeploymentParametersDto.js';
import { DeploymentType } from './DeploymentType.js';
export class CreateKubernetesDeployerDto {
    /**
     * The unique identifier for the SaaS business
     * @example HarperDB
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    /**
     * The unique identifier for this deployment if applicable.
     * @example "my-kafka-consumer"
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public uniqueId?: string;

    /**
     * The type of deployment which meteringco should deploy. These map directly to deployments in the meteringco kubernetes cluster.
     *  <br><br>
     * Example: `"Kafka"`
     * @example "Kafka"
     */
    @IsEnum(DeploymentType, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `deploymentType: The value ${value} is not a valid value for the deploymentType field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty({ default: DeploymentType.kafkaConsumer })
    public deploymentType: DeploymentType;

    /**
     * Configuration for the deployment.
     */
    @ApiProperty({
        type: 'object',

        oneOf: [{ $ref: getSchemaPath('KafkaDeploymentParameters') }],
    })
    @IsDefined()
    @IsNotEmptyObject()
    @IsObject()
    @ValidateNested({ each: true })
    @Type(({ object }) => {
        if (!object?.deploymentType) {
            throw new BadRequestException('deploymentType is requierd for deployment parameters');
        }
        if (object.deploymentType.toLowerCase() === DeploymentType.kafkaConsumer.toLowerCase())
            return KafkaDeploymentParametersDto;
    })
    public deploymentParameters: KafkaDeploymentParametersDto;
}
