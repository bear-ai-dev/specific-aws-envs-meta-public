import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';

jest.mock('@aws-sdk/credential-providers', () => ({
    fromTemporaryCredentials: jest.fn().mockReturnValue('mockCredentials'),
}));

jest.mock('../../utils/aws/awsEc2.js', () => ({
    getInstanceWithFilters: jest.fn(),
}));

jest.mock('../../utils/aws/awsCloudWatch.js', () => ({
    getNetworkOutBytesByInstance: jest.fn(),
    NETWORK_OUT_METRIC_NAME: 'NetworkOut',
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getInstanceWithFilters } = require('../../utils/aws/awsEc2.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { getNetworkOutBytesByInstance } = require('../../utils/aws/awsCloudWatch.js');

const instance = ({ InstanceId, dimensions, customerId, state = 'running' }) => ({
    InstanceId,
    State: { Name: state },
    Tags: [
        ...(dimensions === undefined ? [] : [{ Key: 'meteringcoDimensionId', Value: dimensions }]),
        ...(customerId === undefined ? [] : [{ Key: 'meteringcoCustomerId', Value: customerId }]),
        { Key: 'Name', Value: InstanceId },
    ],
});

const job = (dimensionId = 'dimensionOne') => ({
    data: {
        businessID: 'myCoolCorp',
        subject: 'mySubject',
        rate: '0 */5 * * * *',
        scheduleParameters: {
            iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-egress-reader',
            externalId: 'externalIdOne',
            region: 'us-east-1',
            dimensionId,
            dimensionType: 'instanceNetworkOut',
        },
    },
});

describe('Ec2NetworkOutDataGathererService', () => {
    let service: Ec2NetworkOutDataGathererService;
    let publish: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new Ec2NetworkOutDataGathererService();
        publish = jest.spyOn(StandardMeasurementEntity, 'publish').mockImplementation((request) => ({
            message: 'published',
            id: 'mockId',
            data: [request],
        }));
    });

    afterEach(() => {
        publish.mockRestore();
    });

    it('bills each customer the total bytes their instances sent out', async () => {
        getInstanceWithFilters.mockResolvedValue([
            instance({ InstanceId: 'i-001', dimensions: 'dimensionOne', customerId: 'customerOne' }),
            instance({ InstanceId: 'i-002', dimensions: 'dimensionOne', customerId: 'customerOne' }),
            instance({ InstanceId: 'i-003', dimensions: 'dimensionOne', customerId: 'customerTwo' }),
        ]);
        getNetworkOutBytesByInstance.mockResolvedValue({ 'i-001': 4000000, 'i-002': 2500000, 'i-003': 1750000 });

        await service.readOperationJob(job() as any);

        expect(publish).toHaveBeenCalledTimes(2);
        const published = publish.mock.calls.map(([entity]) => entity);
        const customerOne = published.find(({ customerId }) => customerId === 'customerOne');
        const customerTwo = published.find(({ customerId }) => customerId === 'customerTwo');
        // The bytes of both of customerOne's instances add into one figure
        expect(customerOne.recordValue).toBe(6500000);
        expect(customerTwo.recordValue).toBe(1750000);
        expect(customerOne.dimensionId).toBe('dimensionOne');
        expect(customerOne.businessID).toBe('myCoolCorp');
        expect(customerOne._measurement).toBe(UsageEntity._measurement);
    });

    it('reads the metric of every instance opted into the dimension, in whatever power state', async () => {
        getInstanceWithFilters.mockResolvedValue([
            instance({ InstanceId: 'i-001', dimensions: 'dimensionOne', customerId: 'customerOne', state: 'stopped' }),
            instance({
                InstanceId: 'i-002',
                dimensions: 'dimensionOne',
                customerId: 'customerTwo',
                state: 'terminated',
            }),
        ]);
        getNetworkOutBytesByInstance.mockResolvedValue({ 'i-001': 100, 'i-002': 200 });

        await service.readOperationJob(job() as any);

        // No power state filter is sent to EC2, a stopped instance still owes for what it sent
        const [, , filters] = getInstanceWithFilters.mock.calls[0];
        expect(JSON.stringify(filters)).not.toContain('instance-state-name');
        expect(getNetworkOutBytesByInstance.mock.calls[0][0].instanceIds.sort()).toEqual(['i-001', 'i-002']);
        expect(publish).toHaveBeenCalledTimes(2);
    });

    it('ignores instances without a customer or without the dimension the run is for', async () => {
        getInstanceWithFilters.mockResolvedValue([
            instance({ InstanceId: 'i-001', dimensions: 'dimensionOne', customerId: undefined }),
            instance({ InstanceId: 'i-002', dimensions: 'dimensionOne', customerId: '' }),
            instance({ InstanceId: 'i-003', dimensions: 'dimensionTwo', customerId: 'customerOne' }),
            instance({ InstanceId: 'i-004', dimensions: undefined, customerId: 'customerOne' }),
            instance({ InstanceId: 'i-005', dimensions: 'dimensionTwo,dimensionOne', customerId: 'customerOne' }),
        ]);
        getNetworkOutBytesByInstance.mockResolvedValue({ 'i-005': 64 });

        await service.readOperationJob(job() as any);

        // Only the instance listing the dimension of the run, among several, takes part
        expect(getNetworkOutBytesByInstance.mock.calls[0][0].instanceIds).toEqual(['i-005']);
        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][0].recordValue).toBe(64);
    });

    it('bills an instance which published zeroes and skips one which published nothing', async () => {
        getInstanceWithFilters.mockResolvedValue([
            instance({ InstanceId: 'i-001', dimensions: 'dimensionOne', customerId: 'idleCustomer' }),
            instance({ InstanceId: 'i-002', dimensions: 'dimensionOne', customerId: 'silentCustomer' }),
        ]);
        getNetworkOutBytesByInstance.mockResolvedValue({ 'i-001': 0 });

        await service.readOperationJob(job() as any);

        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][0].customerId).toBe('idleCustomer');
        expect(publish.mock.calls[0][0].recordValue).toBe(0);
    });

    it('does not read any metric when no instance is metered on the dimension', async () => {
        getInstanceWithFilters.mockResolvedValue([
            instance({ InstanceId: 'i-001', dimensions: 'anotherDimension', customerId: 'customerOne' }),
        ]);

        await service.readOperationJob(job() as any);

        expect(getNetworkOutBytesByInstance).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
    });

    it('reads a five minute grained window ending now', async () => {
        getInstanceWithFilters.mockResolvedValue([
            instance({ InstanceId: 'i-001', dimensions: 'dimensionOne', customerId: 'customerOne' }),
        ]);
        getNetworkOutBytesByInstance.mockResolvedValue({ 'i-001': 1 });

        await service.readOperationJob(job() as any);

        const [{ startTime, endTime, period, region }] = getNetworkOutBytesByInstance.mock.calls[0];
        expect(period).toBe(300);
        expect(region).toBe('us-east-1');
        expect(endTime.getTime() - startTime.getTime()).toBe(600000);
    });

    it('rejects a run without an IAM role to assume', async () => {
        await expect(
            service.readOperationJob({ data: { businessID: 'myCoolCorp', scheduleParameters: {} } } as any),
        ).rejects.toThrow('Iam role arn not found');
    });
});
