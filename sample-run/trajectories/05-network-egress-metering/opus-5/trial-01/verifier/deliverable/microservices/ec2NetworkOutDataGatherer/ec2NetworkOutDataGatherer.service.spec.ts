import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';

const getInstanceWithFiltersMock = jest.fn();
const getInstanceMetricTotalsMock = jest.fn();

jest.mock('@aws-sdk/credential-providers', () => ({
    fromTemporaryCredentials: jest.fn(() => 'fakeCredentials'),
}));
jest.mock('../../utils/aws/awsEc2.js', () => ({
    getInstanceWithFilters: (...args) => getInstanceWithFiltersMock(...args),
}));
jest.mock('../../utils/aws/awsCloudwatch.js', () => ({
    EC2_METRIC_NAMESPACE: 'AWS/EC2',
    NETWORK_OUT_METRIC_NAME: 'NetworkOut',
    SUM_STATISTIC: 'Sum',
    getInstanceMetricTotals: (...args) => getInstanceMetricTotalsMock(...args),
}));

const buildInstance = ({ InstanceId, dimensionIds, customerId, state = 'running' }) => ({
    InstanceId,
    State: { Name: state },
    Tags: [
        { Key: 'Name', Value: InstanceId },
        ...(dimensionIds === undefined ? [] : [{ Key: 'meteringcoDimensionId', Value: dimensionIds }]),
        ...(customerId === undefined ? [] : [{ Key: 'meteringcoCustomerId', Value: customerId }]),
    ],
});

describe('Ec2NetworkOutDataGathererService', () => {
    const dimensionId = 'dimension-being-billed';
    const businessID = 'someBusiness';
    let service;
    let publishSpy: jest.SpyInstance;

    beforeEach(() => {
        service = new Ec2NetworkOutDataGathererService();
        publishSpy = jest.spyOn(StandardMeasurementEntity, 'publish').mockImplementation((request) => ({
            message: 'published',
            id: 'fakeId',
            data: [request],
        }));
        getInstanceWithFiltersMock.mockReset();
        getInstanceMetricTotalsMock.mockReset();
    });
    afterEach(() => {
        publishSpy.mockRestore();
    });

    const job = {
        data: {
            businessID,
            subject: 'someSubject',
            rate: '0 */5 * * * *',
            scheduleParameters: {
                iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-egress-reader',
                externalId: 'someExternalId',
                dimensionId,
                region: 'us-east-1',
                dimensionType: 'instanceNetworkOut',
            },
        },
    };

    it('sums the bytes sent out by every instance of a customer into one record per customer', async () => {
        getInstanceWithFiltersMock.mockResolvedValue([
            buildInstance({ InstanceId: 'i-1', dimensionIds: dimensionId, customerId: 'customerA' }),
            buildInstance({ InstanceId: 'i-2', dimensionIds: dimensionId, customerId: 'customerA' }),
            // metered on several dimensions
            buildInstance({
                InstanceId: 'i-3',
                dimensionIds: `someOtherDimension,${dimensionId}`,
                customerId: 'customerB',
                state: 'stopped',
            }),
            // terminated instances still owe for what they sent while they were up
            buildInstance({
                InstanceId: 'i-4',
                dimensionIds: dimensionId,
                customerId: 'customerB',
                state: 'terminated',
            }),
            // not metered on the dimension of the run
            buildInstance({ InstanceId: 'i-5', dimensionIds: 'someOtherDimension', customerId: 'customerC' }),
            // no customer tag
            buildInstance({ InstanceId: 'i-6', dimensionIds: dimensionId, customerId: undefined }),
        ]);
        getInstanceMetricTotalsMock.mockResolvedValue({
            'i-1': { total: 1234, datapointCount: 2 },
            'i-2': { total: 4321, datapointCount: 1 },
            'i-3': { total: 500, datapointCount: 1 },
            'i-4': { total: 1, datapointCount: 1 },
        });

        await service.readOperationJob(job);

        const [{ instanceIds, metricName }] = getInstanceMetricTotalsMock.mock.calls[0];
        expect([...instanceIds].sort()).toEqual(['i-1', 'i-2', 'i-3', 'i-4']);
        expect(metricName).toBe('NetworkOut');

        const published = publishSpy.mock.calls.map(([measurement]) => measurement);
        expect(published.length).toBe(2);
        const customerA = published.find(({ customerId }) => customerId === 'customerA');
        const customerB = published.find(({ customerId }) => customerId === 'customerB');
        expect(customerA.recordValue).toBe(5555);
        expect(customerA.dimensionId).toBe(dimensionId);
        expect(customerA.businessID).toBe(businessID);
        expect(customerA._measurement).toBe(UsageEntity._measurement);
        expect(customerB.recordValue).toBe(501);
    });

    it('does not record usage for a customer without any observation', async () => {
        getInstanceWithFiltersMock.mockResolvedValue([
            buildInstance({ InstanceId: 'i-1', dimensionIds: dimensionId, customerId: 'customerA' }),
            buildInstance({ InstanceId: 'i-2', dimensionIds: dimensionId, customerId: 'customerB' }),
        ]);
        getInstanceMetricTotalsMock.mockResolvedValue({
            'i-1': { total: 0, datapointCount: 4 },
            'i-2': { total: 0, datapointCount: 0 },
        });

        await service.readOperationJob(job);

        const published = publishSpy.mock.calls.map(([measurement]) => measurement);
        expect(published.length).toBe(1);
        expect(published[0].customerId).toBe('customerA');
        // an instance which reported zeroes is billed zero, in bytes, not dropped
        expect(published[0].recordValue).toBe(0);
    });

    it('rejects a run which does not carry a role to assume', async () => {
        await expect(
            service.readOperationJob({ data: { businessID, subject: 'someSubject', scheduleParameters: {} } }),
        ).rejects.toThrow();
    });
});
