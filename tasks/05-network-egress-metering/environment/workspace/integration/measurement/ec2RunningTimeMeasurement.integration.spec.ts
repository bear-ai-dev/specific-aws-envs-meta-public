import { getInstanceWithFilters, updateInstanceTags } from '../utils/ec2.js';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
} from '../setupAndTeardown/setup.js';
import { sleep } from '../utils/utils.js';
import { EC2InstanceTimeMeasurement } from '../client/publicClient/measurement.js';
import { AggregationInterval, AggregationMethod, Dimension, Rounding } from '../client/publicClient/dimension.js';

describe('Test EC2 Running Time Measurement', () => {
    const region = 'us-east-1';
    let serviceUsage;
    let instanceList;
    let instanceIds;
    let measurement;
    let dimension;
    let offering;
    let customer;
    beforeAll(async () => {
        instanceList = await getInstanceWithFilters(region, [
            { Name: 'instance-state-name', Values: ['running'] },
            { Name: 'tag-key', Values: ['aws:ec2spot:fleet-request-id'] },
        ]);
        instanceIds = instanceList.map((instance) => instance.InstanceId);
        console.debug('Integration test instance List: ', JSON.stringify(instanceIds, null, 2));
        measurement = new EC2InstanceTimeMeasurement();
        await measurement.create({
            name: 'Measure EC2',
            iamRoleArn: 'arn:aws:iam::123456789012:role/meteringco-read-only',
            externalId: '',
            region: 'us-east-1',
        });
        dimension = new Dimension();
        await dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            name: 'EC2 Dimension',
            consumptionPrice: '0.1',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'hour',
                type: 'time',
            },
            measurementId: measurement.measurementId,
        });
        offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
    });

    test('Test Missing Customer', async () => {
        try {
            const instanceTags = [
                {
                    Key: 'meteringcoDimensionId',
                    Value: dimension.dimensionId,
                },
                {
                    Key: 'meteringcoCustomerId',
                    Value: '',
                },
            ];
            await updateInstanceTags(region, instanceIds, instanceTags);
            console.debug('Instance tags: ', JSON.stringify(instanceTags, null, 2));
            await sleep(1000 * 60 * 5.5); // Scheduler runs every 5 minutes
            serviceUsage = await customer.getUsage(
                new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
                new Date().toISOString(),
                AggregationInterval.None
            );
            console.debug('Service Usage: ', JSON.stringify(serviceUsage, null, 2));
        } catch (e) {
            console.error(e);
            expect.assertions(1);
        }
        expect(serviceUsage[0].usage.length).toBe(0);
    });

    test('Test Missing Dimension', async () => {
        try {
            const instanceTags = [
                {
                    Key: 'meteringcoDimensionId',
                    Value: '',
                },
                {
                    Key: 'meteringcoCustomerId',
                    Value: customer.customerId,
                },
            ];
            await updateInstanceTags(region, instanceIds, instanceTags);
            console.debug('Instance tags: ', JSON.stringify(instanceTags, null, 2));
            await sleep(1000 * 60 * 5.5); // Scheduler runs every 5 minutes
            serviceUsage = await customer.getUsage(
                new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
                new Date().toISOString(),
                AggregationInterval.None
            );
            console.debug('Service Usage: ', JSON.stringify(serviceUsage, null, 2));
        } catch (e) {
            console.error(e);
            expect.assertions(1);
        }
        expect(serviceUsage[0].usage.length).toBe(0);
    });

    test('Test Missing Dimension and Customer', async () => {
        try {
            const instanceTags = [
                {
                    Key: 'meteringcoDimensionId',
                    Value: '',
                },
                {
                    Key: 'meteringcoCustomerId',
                    Value: '',
                },
            ];
            await updateInstanceTags(region, instanceIds, instanceTags);
            console.debug('Instance tags: ', JSON.stringify(instanceTags, null, 2));
            await sleep(1000 * 60 * 5.5); // Scheduler runs every 5 minutes
            serviceUsage = await customer.getUsage(
                new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
                new Date().toISOString(),
                AggregationInterval.None
            );
            console.debug('Service Usage: ', JSON.stringify(serviceUsage, null, 2));
        } catch (e) {
            console.error(e);
            expect.assertions(1);
        }
        expect(serviceUsage[0].usage.length).toBe(0);
    });

    test('Test EC2 Running Time Measurement Happy Path', async () => {
        try {
            const instanceTags = [
                {
                    Key: 'meteringcoDimensionId',
                    Value: dimension.dimensionId,
                },
                {
                    Key: 'meteringcoCustomerId',
                    Value: customer.customerId,
                },
            ];
            await updateInstanceTags(region, instanceIds, instanceTags);
            console.debug('Instance tags: ', JSON.stringify(instanceTags, null, 2));
            await sleep(1000 * 60 * 5.5); // Scheduler runs every 5 minutes
            serviceUsage = await customer.getUsage(
                new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
                new Date().toISOString(),
                AggregationInterval.None
            );
            console.debug('Service Usage: ', JSON.stringify(serviceUsage, null, 2));
        } catch (e) {
            console.error(e);
            expect.assertions(1);
        }
        expect(serviceUsage[0].usage.length).toBe(1);
        expect(Number(serviceUsage[0].usage[0].recordValue)).toBeCloseTo((instanceList.length * 5) / 60);
    });
});
