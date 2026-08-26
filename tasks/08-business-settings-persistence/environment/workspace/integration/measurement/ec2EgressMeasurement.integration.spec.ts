import { getInstanceWithFilters, updateInstanceTags } from '../utils/ec2.js';
import { EC2EgressMeasurement } from '../client/publicClient/measurement.js';
import { AggregationInterval, AggregationMethod, Dimension, Rounding } from '../client/publicClient/dimension.js';
import { setupCustomerWallStrTrading, setupSimpleUsageBasedOffering } from '../setupAndTeardown/setup.js';
import { sleep } from '../utils/utils.js';
import { getEc2Egress } from '../utils/cloudwatch.js';

describe('Test EC2 Egress Measurement', () => {
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
        measurement = new EC2EgressMeasurement();
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
            name: 'EC2 Egress',
            consumptionPrice: '0.1',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'byte',
                type: 'data',
            },
            measurementId: measurement.measurementId,
        });
        offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
    });

    test('Test EC2 Egress Measurement Happy Path', async () => {
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
        const serviceTimestamp = new Date(serviceUsage[0].usage[0].timestamp);
        const startTime = new Date(serviceTimestamp.getTime() - 11 * 60 * 1000);
        const endTime = new Date(serviceTimestamp.getTime() - 5 * 60 * 1000);
        console.debug('Start Time: ', startTime.toISOString() + ' End Time: ', endTime.toISOString());
        const cloudwatchData = await getEc2Egress(region, startTime, endTime, instanceIds);
        console.debug('Cloudwatch Data: ', JSON.stringify(cloudwatchData, null, 2));
        const key = cloudwatchData.reduce((acc, curr) => acc + curr.Values[curr.Values.length - 1], 0);
        console.debug('Key: ', key);
        expect(Math.abs(Number(serviceUsage[0].usage[0].recordValue) - key)).toBeLessThan(0.05);
    });
});
