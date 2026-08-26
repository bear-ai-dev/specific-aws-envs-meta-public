import {
    DatastoreBasedMeasurementConfig,
    DatastorePlatform,
    UsageRecordInKafkaMeasurement,
} from '../client/publicClient/measurement.js';
import { KafkaManager } from '../../src/kubernetes-deployer/entities/kafkaConsumer/kafkaClient.entity.js';
import { KafkaSecurityMechanism } from '../../src/kubernetes-deployer/entities/kafkaConsumer/KafkaSecurityMechanism.js';
import { sleep } from '../utils/utils.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
} from '../setupAndTeardown/setup.js';
import { DatetimeUtils } from '../utils/Datetime.js';
import { Kafka } from 'kafkajs';

describe('KafkaConsumer', () => {
    let kafkaClient: Kafka;
    let measurement: UsageRecordInKafkaMeasurement;
    beforeAll(async () => {
        // Create a valid datastore measurement
        measurement = new UsageRecordInKafkaMeasurement(
            undefined,
            'kafka-consumer-int-test',
            new DatastoreBasedMeasurementConfig(DatastorePlatform.KAFKA, undefined, {
                username: process.env.KAFKA_USERNAME,
                password: process.env.KAFKA_PASSWORD,
                bootstrapServerEndpoint: process.env.KAFKA_BOOTSTRAP_SERVER_ENDPOINT,
                securityMechanism: KafkaSecurityMechanism.PLAIN,
                topic: 'test',
                dlqTopic: 'dlqtest',
            })
        );
        const client = new KafkaManager({
            username: process.env.KAFKA_USERNAME as string,
            password: process.env.KAFKA_PASSWORD as string,
            bootstrapServerEndpoint: process.env.KAFKA_BOOTSTRAP_SERVER_ENDPOINT as string,
            securityMechanism: KafkaSecurityMechanism.PLAIN,
            clientId: 'kafka-consumer-int-test',
        });
        kafkaClient = KafkaManager.initalizeClient(client);
        await measurement.create();
        await sleep(30000);
    });
    afterAll(async () => {
        await measurement.delete();
    });
    it('Should consume valid messages from Kafka', async () => {
        const dimension = await setupDimensionRequest();
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        // Push a valid message to Kafka
        const timestamp = DatetimeUtils.fiveMinutesAgo();
        await KafkaManager.writeMessageToTopic({
            topic: process.env.KAFKA_TOPIC as string,
            client: kafkaClient,
            message: JSON.stringify({
                customerId: customer.customerId,
                dimensionId: dimension.dimensionId,
                recordValue: '1',
                timestamp: timestamp.toISOString(),
                metadata: {
                    foo: 'bar',
                },
            }),
            timestamp: timestamp.getTime().toString(),
        });
        await sleep(15000);
        // Read usage API for the usage measurement and validate
        const [{ dimensionId, usage }] = await customer.getUsage(
            DatetimeUtils.oneHourAgo().toISOString(),
            new Date().toISOString(),
            'hour'
        );
        expect(dimensionId).toEqual(dimension.dimensionId);
        expect(usage.find(({ value }) => value === 1)).toBeDefined();
    });
    it('Should write to DLQ if message is invalid', async () => {
        // Push a valid message to Kafka
        // Read usage API for the usage measurement and validate
    });
});
