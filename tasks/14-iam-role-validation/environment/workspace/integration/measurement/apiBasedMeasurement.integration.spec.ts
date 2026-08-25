import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupS3Measurement,
    setupSimpleUsageBasedOffering,
    setupSimpleService,
} from '../setupAndTeardown/setup.js';
import { Usage } from '../client/publicClient/usage.js';
import { sleep } from '../utils/utils.js';
import { AggregationInterval } from '../client/publicClient/dimension.js';
import {
    VALID_MEASUREMENT_INPUT,
    METADATA_INPUT,
    INVALID_METADATA_INPUT,
} from './apiBasedMeasurement.integration.input.js';

describe('Test different record values', () => {
    const largeObjectInput = [];
    for (let i = 0; i < 20; i++) {
        largeObjectInput.push(i.toString());
    }
    VALID_MEASUREMENT_INPUT.push({ recordValues: largeObjectInput, expected: largeObjectInput });
    test.concurrent.each(VALID_MEASUREMENT_INPUT)(
        'Record value with input $recordValues',
        async ({ recordValues, expected }) => {
            console.debug('Input: ', recordValues, expected);
            const usage = new Usage();
            const dimension = await setupDimensionRequest();
            const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
            const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

            await Promise.all(
                recordValues.map(async (recordValue, index) => {
                    return usage.create({
                        timestamp: new Date(new Date().getTime() - 1000 * (recordValues.length - index)).toISOString(),
                        dimensionId: dimension.dimensionId,
                        recordValue,
                        customerId: customer.customerId,
                    });
                })
            );

            await sleep(1000 * 5);
            const serviceUsage = await customer.getUsage(
                new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
                new Date().toISOString(),
                AggregationInterval.None
            );
            console.debug('Service Usage: ', JSON.stringify(serviceUsage, null, 2));
            expect(serviceUsage[0].usage.length).toBe(expected.length);
            expected.forEach((expectedValue, index) => {
                expect(serviceUsage[0].usage[index].recordValue).toBe(expectedValue);
            });
        }
    );
});

describe('Test schema', () => {
    let usage;
    let dimension;
    let offering;
    let customer;
    let dimensionId;
    let customerId;
    beforeAll(async () => {
        usage = new Usage();
        dimension = await setupDimensionRequest();
        await sleep(1000 * 2);
        dimensionId = dimension.dimensionId;
        offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(1000 * 2);
        customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        customerId = customer.customerId;
    });

    test.each([
        { timestamp: new Date().toUTCString(), dimensionId, recordValue: '1', customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: 1, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: 'a', customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: [1], customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: { a: 1 }, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: true, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: null, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: undefined, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: NaN, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: Infinity, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: -Infinity, customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: '', customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: ' ', customerId },
        { timestamp: new Date().toISOString(), recordValue: '1', customerId },
        { timestamp: new Date().toISOString(), dimensionId: 'randomValue', recordValue: '1', customerId },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: '1' },
        { timestamp: new Date().toISOString(), dimensionId, recordValue: '1', customerId: 'randomValue' },
        { timeStamp: new Date().toISOString(), dimensionId, recordValue: '1', customerId },
        { dimensionId, recordValue: '1', customerId },
    ])(`Record value with invalid input %p`, async (usageRecord: {}) => {
        await expect(usage.create(usageRecord)).rejects.toThrow();
    });
});

describe('Test metadata', () => {
    test.concurrent.each(METADATA_INPUT)('Record value with metadata $metadata', async ({ metadata }) => {
        console.debug('Input: ', metadata);
        const usage = new Usage();
        const dimension = await setupDimensionRequest();
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        await usage.create({
            timestamp: new Date().toISOString(),
            dimensionId: dimension.dimensionId,
            recordValue: '1',
            customerId: customer.customerId,
            metadata,
        });

        await sleep(1000 * 5);
        const customerUsage = await customer.getUsage(
            new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
            new Date().toISOString(),
            AggregationInterval.None
        );
        console.debug('Customer Usage: ', JSON.stringify(customerUsage, null, 2));
        expect(customerUsage[0].usage.length).toBe(1);
        expect(customerUsage[0].usage[0].metadata).toMatchObject(metadata);
    });
});

describe('Test invalid metadata', () => {
    let usage;
    let dimension;
    let offering;
    let customer;
    let dimensionId;
    let customerId;
    beforeAll(async () => {
        usage = new Usage();
        dimension = await setupDimensionRequest();
        await sleep(1000 * 2);
        dimensionId = dimension.dimensionId;
        offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(1000 * 2);
        customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        customerId = customer.customerId;
    });

    test.each(INVALID_METADATA_INPUT)(`Record value with invalid metadata $metadata`, async ({ metadata }) => {
        await expect(
            usage.create({
                timestamp: new Date().toISOString(),
                dimensionId: dimension.dimensionId,
                recordValue: '1',
                customerId: customer.customerId,
                metadata,
            })
        ).rejects.toThrow();
    });
});
