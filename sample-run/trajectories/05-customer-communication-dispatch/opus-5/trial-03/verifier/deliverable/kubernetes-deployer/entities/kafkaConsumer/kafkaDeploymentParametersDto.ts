import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsEnum, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { KafkaSecurityMechanism } from './KafkaSecurityMechanism.js';

export class KafkaDeploymentParametersDto {
    /**
     * The security protocol to use when connecting to the Kafka cluster. Defaults to `PLAIN`. Note this is not PLAINTEXT. PLAIN is the SASL_PLAIN protocol.
     * <br><br>
     * Example: `"PLAIN"`
     * @example "PLAIN"
     * */
    @IsEnum(KafkaSecurityMechanism, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `securityProtocol must be one of the following values: ${correctValues}`;
        },
    })
    @ApiProperty({
        externalDocs: {
            url: 'https://docs.confluent.io/platform/current/kafka/authentication_sasl/authentication_sasl_plain.html#sasl-plain-overview',
        },
        example: 'PLAIN',
        description:
            'The security protocol to use when connecting to the Kafka cluster. Defaults to `PLAIN`. Note this is not PLAINTEXT. PLAIN is the SASL_PLAIN protocol. <br><br> Example: `"PLAIN"`',
    })
    @IsOptional()
    public securityMechanism?: KafkaSecurityMechanism;

    /**
     * The username to use when connecting to the Kafka cluster.
     * <br><br>
     * Example: `"admin"`
     * @example "admin"
     * */
    @IsString()
    @IsDefined()
    @ApiProperty({
        required: true,
        description: 'The username to use when connecting to the Kafka cluster. <br><br> Example: `"admin"`',
        example: 'admin',
    })
    public username?: string;

    /**
     * The password to use when connecting to the Kafka cluster.
     * <br><br>
     * Example: `"hunter2"`
     * @example "hunter2"
     * */
    @IsString()
    @IsDefined()
    @ApiProperty({
        required: true,
        description: 'The password to use when connecting to the Kafka cluster. <br><br> Example: `"hunter2"`',
        example: 'hunter2',
    })
    public password?: string;
    /**
     * The endpoint of the Kafka cluster to connect to.
     * <br><br>
     * Example: `"kafka.meteringco.example"`
     * @example "kafka.meteringco.example"
     **/
    @IsString()
    @IsDefined()
    @ApiProperty({
        required: true,
        description: 'The endpoint of the Kafka cluster to connect to. <br><br> Example: `"kafka.meteringco.example"`',
        example: 'kafka.meteringco.example',
    })
    public bootstrapServerEndpoint?: string;

    /**
     * The topic to subscribe to.
     * <br><br>
     * Example: `"test-topic"`
     * @example "test-topic"
     * */
    @IsString()
    @ApiProperty({
        description: 'The topic to subscribe to. <br><br> Example: `"test-topic"`',
        example: `"test-topic"`,
        required: true,
    })
    public topic: string;

    /**
     * The DLQ topic to write to when a message fails to be processed.
     * <br><br>
     * Example: `"dlq-topic"`
     * @example "dlq-topic"
     * */
    @IsString()
    @ApiProperty({
        description: 'The DLQ topic to write to when a message fails to be processed. <br><br> Example: `"dlq-topic"`',
        example: `"dlq-topic"`,
        required: true,
    })
    public dlqTopic: string;

    constructor(kafkaDeploymentParams: KafkaDeploymentParametersDto) {
        if (kafkaDeploymentParams) {
            const {
                username,
                password,
                bootstrapServerEndpoint: bootstrapServerEndpoint,
                topic,
                securityMechanism,
                dlqTopic,
            } = kafkaDeploymentParams;
            this.username = username;
            this.password = password;
            this.bootstrapServerEndpoint = bootstrapServerEndpoint;
            this.topic = topic;
            this.securityMechanism = securityMechanism ? securityMechanism : KafkaSecurityMechanism.PLAIN;
            this.dlqTopic = dlqTopic;
        }
    }
}
