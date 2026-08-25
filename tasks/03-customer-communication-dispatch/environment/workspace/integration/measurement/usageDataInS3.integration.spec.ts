import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupS3Measurement,
    setupSimpleUsageBasedOffering,
} from '../setupAndTeardown/setup.js';
import { AggregationInterval } from '../client/publicClient/dimension.js';
import { getDocument, listDocuments, putDocument } from '../utils/s3.js';
import { sleep } from '../utils/utils.js';
import { ONE_OBJECT_INPUT } from './usageDataInS3.integration.input.js';
import { DLQ_INPUT } from './usageDataInS3.integration.input.js';
import { assumeRole } from '../utils/sts.js';
import { Customer } from '../client/publicClient/customer.js';

const TEST_1_ACCOUNT_ID: string = process.env.TEST_1_ACCOUNT_ID;
const TEST_2_ACCOUNT_ID: string = process.env.TEST_2_ACCOUNT_ID;
const regex = /s3:\/\/([a-zA-Z0-9-]+)\/(.*)/;

const constructPrefix = (root: string, randomize: boolean = true, path: boolean = true) => {
    const fullPath = path
        ? new Date()
              .toISOString()
              .split(/-|T|:|\./)
              .join('/')
        : new Date()
              .toISOString()
              .split(/-|T|:|\./)
              .join('');
    return `${root}/${fullPath}${randomize ? Math.round(Math.random() * 1000).toString() : ''}.txt`;
};

const printData = (measurement, customer, dimension, offering) => {
    console.debug('Print out resource data');
    console.debug('Measurement: ', JSON.stringify(measurement, null, 2));
    console.debug('Customer: ', JSON.stringify(customer, null, 2));
    console.debug('Dimension: ', JSON.stringify(dimension, null, 2));
    console.debug('Offering: ', JSON.stringify(offering, null, 2));
};

xdescribe('NDJSON Usage Data', () => {
    const largeObjectInput = [];
    for (let i = 0; i < 200; i++) {
        largeObjectInput.push(i.toString());
    }
    ONE_OBJECT_INPUT.push({ recordValues: largeObjectInput, expected: largeObjectInput });
    test.concurrent.each(ONE_OBJECT_INPUT)(
        'Validate NDJSON with input $recordValues',
        async ({ recordValues, expected }) => {
            const measurement = await setupS3Measurement(TEST_1_ACCOUNT_ID);

            const dimension = await setupDimensionRequest(measurement.measurementId);
            const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
            const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
            printData(measurement, customer, dimension, offering);
            const match = regex.exec(measurement.ingestion);
            const bucket = match[1];
            const key = match[2];
            await sleep(1000 * 10);
            const credentials = await assumeRole(
                measurement.iamRoleArn,
                measurement.externalId,
                measurement.region,
                process.env.TEST_1_AWS_ACCESS_KEY_ID,
                process.env.TEST_1_AWS_SECRET_ACCESS_KEY
            );
            let objectContent = '';
            let counter = recordValues.length + 1;
            for (const recordValue of recordValues) {
                objectContent +=
                    JSON.stringify({
                        customerId: customer.customerId,
                        dimensionId: dimension.dimensionId,
                        recordValue,
                        timestamp: new Date(new Date().getTime() - 1000 * counter * 5).toISOString(),
                    }) + '\n';
                counter--;
            }
            const objectKey = constructPrefix(key);
            await putDocument(
                objectContent,
                bucket,
                objectKey,
                measurement.region,
                credentials.AccessKeyId,
                credentials.SecretAccessKey,
                credentials.SessionToken
            );
            await sleep(1000 * 60 * 3);
            // validating
            const customerUsage = await customer.getUsage(
                new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
                new Date().toISOString(),
                AggregationInterval.None
            );
            console.debug('customer Usage: ', JSON.stringify(customerUsage, null, 2));
            expect(customerUsage[0].usage.length).toBe(expected.length);
            expected.forEach((expectedValue, index) => {
                expect(customerUsage[0].usage[index].recordValue).toBe(expectedValue);
            });
            // DLQ
            if (expected.length < recordValues.length) {
                const dlqMatch = regex.exec(measurement.dlq);
                const dlqBucket = dlqMatch[1];
                const dlqKey = dlqMatch[2];
                const dlqMsgList = await listDocuments(
                    dlqBucket,
                    objectKey,
                    measurement.region,
                    credentials.AccessKeyId,
                    credentials.SecretAccessKey,
                    credentials.SessionToken
                );
                console.debug('DLQ Message List: ', JSON.stringify(dlqMsgList, null, 2));
                expect(dlqMsgList.Contents.length).toBe(recordValues.length - expected.length);
            }
        }
    );
});

xdescribe('S3 Usage Data', () => {
    let measurement;
    let customer: Customer;
    let dimension;
    let offering;
    let match;
    let bucket;
    let key;
    let credentials;

    beforeEach(async () => {
        measurement = await setupS3Measurement(TEST_1_ACCOUNT_ID);

        dimension = await setupDimensionRequest(measurement.measurementId);
        offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        match = regex.exec(measurement.ingestion);
        bucket = match[1];
        key = match[2];
        await sleep(1000 * 10);
        credentials = await assumeRole(
            measurement.iamRoleArn,
            measurement.externalId,
            measurement.region,
            process.env.TEST_1_AWS_ACCESS_KEY_ID,
            process.env.TEST_1_AWS_SECRET_ACCESS_KEY
        );
        printData(measurement, customer, dimension, offering);
    });

    test('Invalid AWS account number', async () => {
        await expect(setupS3Measurement()).rejects.toThrow();
    });

    test('Validate usage record under root', async () => {
        const recordValue = '22';
        let objectContent = JSON.stringify({
            timestamp: new Date().toISOString(),
            dimensionId: dimension.dimensionId,
            recordValue,
            customerId: customer.customerId,
        });
        const objectKey = constructPrefix(key, true, false);
        await putDocument(
            objectContent,
            bucket,
            objectKey,
            measurement.region,
            credentials.AccessKeyId,
            credentials.SecretAccessKey,
            credentials.SessionToken
        );
        // logstash runs every minute
        await sleep(1000 * 60 * 1.5);
        // validating
        const customerUsage = await customer.getUsage(
            new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
            new Date().toISOString(),
            AggregationInterval.None
        );
        console.debug('Customer Usage: ', JSON.stringify(customerUsage, null, 2));
        expect(customerUsage[0].usage.length).toBe(1);
        expect(customerUsage[0].usage[0].recordValue).toBe(recordValue);
    });

    const largeObjectInput = [];
    for (let i = 0; i < 20; i++) {
        largeObjectInput.push(i.toString());
    }
    test('Validate multiple NDJSON', async () => {
        largeObjectInput.map(async (recordValue, index) => {
            const usageRecord = JSON.stringify({
                timestamp: new Date(new Date().getTime() + (index + 1) * 1000).toISOString(),
                customerId: customer.customerId,
                dimensionId: dimension.dimensionId,
                recordValue,
            });
            const objectKey = constructPrefix(key, true);
            await putDocument(
                usageRecord,
                bucket,
                objectKey,
                measurement.region,
                credentials.AccessKeyId,
                credentials.SecretAccessKey,
                credentials.SessionToken
            );
        });
        await sleep(1000 * 60 * 3);
        // validating
        const customerUsage = await customer.getUsage(
            new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
            new Date().toISOString(),
            AggregationInterval.None
        );
        console.debug('Customer Usage: ', JSON.stringify(customerUsage, null, 2));
        expect(customerUsage[0].usage.length).toBe(largeObjectInput.length);
        largeObjectInput.forEach((expectedValue, index) => {
            expect(customerUsage[0].usage[index].recordValue).toBe(expectedValue);
        });
    });

    test('Validate measurement update', async () => {
        await measurement.update(TEST_2_ACCOUNT_ID);
        const recordValue = '171';
        let objectContent = JSON.stringify({
            timestamp: new Date(new Date().getTime() + (1 + 1) * 1000).toISOString(),
            customerId: customer.customerId,
            dimensionId: dimension.dimensionId,
            recordValue,
        });
        const objectKey = constructPrefix(key);
        await sleep(1000 * 10);
        const NewCredentials = await assumeRole(
            measurement.iamRoleArn,
            measurement.externalId,
            measurement.region,
            process.env.TEST_2_AWS_ACCESS_KEY_ID,
            process.env.TEST_2_AWS_SECRET_ACCESS_KEY
        );
        await putDocument(
            objectContent,
            bucket,
            objectKey,
            measurement.region,
            NewCredentials.AccessKeyId,
            NewCredentials.SecretAccessKey,
            NewCredentials.SessionToken
        );
        await sleep(1000 * 60 * 3);
        // validating
        const customerUsage = await customer.getUsage(
            new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
            new Date().toISOString(),
            AggregationInterval.None
        );
        console.debug(`Validating measurement update ${JSON.stringify(customerUsage, null, 2)}`);
        expect(customerUsage[0].usage[customerUsage[0].usage.length - 1].recordValue).toBe(recordValue);
    });

    test('Validate measurement deletion', async () => {
        await customer.delete();
        await offering.delete();
        await dimension.delete();
        await measurement.delete();
        await expect(measurement.get()).rejects.toThrow();
    });
});

xdescribe('S3 DLQ', () => {
    let measurement;
    let customer: Customer;
    let dimension;
    let offering;
    let match;
    let bucket;
    let key;
    let credentials;

    beforeAll(async () => {
        measurement = await setupS3Measurement(TEST_1_ACCOUNT_ID);
        await sleep(2 * 1000);
        dimension = await setupDimensionRequest(measurement.measurementId);
        await sleep(2 * 1000);
        offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(2 * 1000);
        customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(2 * 1000);
        match = regex.exec(measurement.ingestion);
        bucket = match[1];
        key = match[2];
        await sleep(1000 * 10);
        credentials = await assumeRole(
            measurement.iamRoleArn,
            measurement.externalId,
            measurement.region,
            process.env.TEST_1_AWS_ACCESS_KEY_ID,
            process.env.TEST_1_AWS_SECRET_ACCESS_KEY
        );
        printData(measurement, customer, dimension, offering);
    });

    // Concurrent cannot be used with beforeAll, not supported by jest
    test.each(DLQ_INPUT)('Validate DLQ with input $content', async ({ content, items }) => {
        const objectKey = constructPrefix(key);
        await putDocument(
            content.toString(),
            bucket,
            objectKey,
            measurement.region,
            credentials.AccessKeyId,
            credentials.SecretAccessKey,
            credentials.SessionToken
        );
        console.debug('Object key: ', objectKey);
        // logstash runs every minute
        await sleep(1000 * 60 * 2);
        // validating
        const customerUsage = await customer.getUsage(
            new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
            new Date().toISOString(),
            AggregationInterval.None
        );
        console.debug('Customer Usage: ', JSON.stringify(customerUsage, null, 2));
        expect(customerUsage[0].usage.length).toBe(0);
        const dlqMatch = regex.exec(measurement.dlq);
        const dlqBucket = dlqMatch[1];
        const dlqKey = dlqMatch[2];
        const dlqMsgList = await listDocuments(
            dlqBucket,
            objectKey,
            measurement.region,
            credentials.AccessKeyId,
            credentials.SecretAccessKey,
            credentials.SessionToken
        );
        console.debug('DLQ Messages: ', JSON.stringify(dlqMsgList, null, 2));
        expect(dlqMsgList.Contents?.length).toBe(items);
        const dlqObjectContent = dlqMsgList.Contents?.[0];
        if (!dlqObjectContent) {
            throw new Error('missing content from object in DLQ');
        }
        const objectDLQDoc = await getDocument(
            dlqBucket,
            dlqObjectContent?.Key,
            measurement.region,
            credentials.AccessKeyId,
            credentials.SecretAccessKey,
            credentials.SessionToken
        );
        expect(objectDLQDoc.Body).toEqual(expect.anything());
    });
});
