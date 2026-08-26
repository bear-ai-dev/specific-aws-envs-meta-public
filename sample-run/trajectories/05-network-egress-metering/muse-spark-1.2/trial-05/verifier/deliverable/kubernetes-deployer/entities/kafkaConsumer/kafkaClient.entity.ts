import { KafkaSecurityMechanism } from './KafkaSecurityMechanism.js';
import { Kafka, Partitioners } from 'kafkajs';
import { NotImplementedException } from '@nestjs/common';
import { AuditService } from '../../../audit/audit.service.js';
import { AuditScope } from '../../../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';

export class KafkaManager {
    constructor({
        username,
        password,
        bootstrapServerEndpoint,
        securityMechanism,
        clientId,
    }: {
        username: string;
        password: string;
        bootstrapServerEndpoint: string;
        securityMechanism: KafkaSecurityMechanism;
        clientId: string;
    }) {
        this.username = username;
        this.password = password;
        this.bootstrapServerEndpoint = bootstrapServerEndpoint;
        this.securityMechanism = securityMechanism;
        this.clientId = clientId;
    }
    public username: string;
    public password: string;
    public bootstrapServerEndpoint: string;
    public securityMechanism: KafkaSecurityMechanism;
    public clientId: string;

    public static initalizeClient(kafkaManager: KafkaManager): Kafka {
        const {
            username,
            password,
            bootstrapServerEndpoint: bootstrapServerEndpoint,
            securityMechanism,
            clientId,
        } = kafkaManager;
        if (securityMechanism === KafkaSecurityMechanism.PLAIN) {
            const kafka = new Kafka({
                clientId,
                brokers: [bootstrapServerEndpoint],
                ssl: true,
                sasl: {
                    mechanism: 'plain',
                    username,
                    password,
                },
            });
            return kafka;
        } else {
            throw new NotImplementedException('Only PLAIN security mechanism is supported for Kafka Client');
        }
    }
    public static writeMessageToTopic = async ({
        client,
        message,
        topic,
        partitionId,
        timestamp,
    }: {
        client: Kafka;
        message: string;
        topic: string;
        partitionId?: string;
        timestamp?: string;
    }): Promise<void> => {
        const producer = client.producer({
            createPartitioner: Partitioners.DefaultPartitioner,
            retry: { retries: 5, factor: 0.2, multiplier: 2, initialRetryTime: 300, maxRetryTime: 30000 },
        });
        await producer.connect();

        try {
            // Automatically retries 5 times
            await producer.send({
                topic,
                messages: [{ value: message, key: partitionId, timestamp }],
            });
        } catch (error) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Error writing message to Kafka topic: ${topic}`,
                data: [serializeError(error)],
            });
        }

        await producer.disconnect();
    };

    public static setupConsumer = async ({
        client,
        topic,
        groupId,
        fromBeginning,
    }: {
        client: Kafka;
        topic: string;
        groupId: string;
        fromBeginning: boolean;
    }) => {
        const consumer = client.consumer({ groupId });
        await consumer.connect();
        await consumer.subscribe({ topic, fromBeginning });
        return consumer;
    };
}
