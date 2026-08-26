import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { getInstanceMetricSums } from '../../utils/aws/awsCloudWatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';

jest.mock('@aws-sdk/credential-providers', () => ({
    fromTemporaryCredentials: jest.fn(() => 'creds'),
}));
jest.mock('../../utils/aws/awsEc2.js', () => ({
    getInstanceWithFilters: jest.fn(),
}));
jest.mock('../../utils/aws/awsCloudWatch.js', () => ({
    EC2_METRIC_NAMESPACE: 'AWS/EC2',
    NETWORK_OUT_METRIC_NAME: 'NetworkOut',
    getInstanceMetricSums: jest.fn(),
}));

const instance = (InstanceId: string, tags: Record<string, string>, state = 'running') => ({
    InstanceId,
    State: { Name: state },
    Tags: Object.keys(tags).map((Key) => ({ Key, Value: tags[Key] })),
});

const job = (scheduleParameters) =>
    ({
        data: {
            scheduleParameters,
            businessID: 'businessOne',
            subject: 'subjectOne',
            rate: '*/5 * * * *',
        },
    }) as any;

const scheduleParameters = {
    dimensionType: 'instanceNetworkOut',
    iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-egress-reader',
    externalId: 'external-id',
    dimensionId: 'dimensionOne',
    region: 'us-east-1',
};

describe('Ec2NetworkOutDataGathererService', () => {
    let service;
    let publishSpy: jest.SpyInstance;
    beforeEach(() => {
        jest.clearAllMocks();
        service = new Ec2NetworkOutDataGathererService();
        publishSpy = jest.spyOn(StandardMeasurementEntity, 'publish').mockImplementation((request: any) => ({
            message: 'published',
            id: 'id',
            data: [request],
        }));
    });
    afterEach(() => {
        publishSpy.mockRestore();
    });

    it('records the bytes sent out by every instance of a customer as a single figure', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', { meteringcoDimensionId: 'dimensionOne', meteringcoCustomerId: 'customerOne' }),
            instance('i-2', { meteringcoDimensionId: 'dimensionOne', meteringcoCustomerId: 'customerOne' }),
            instance('i-3', { meteringcoDimensionId: 'dimensionTwo,dimensionOne', meteringcoCustomerId: 'customerTwo' }),
        ]);
        (getInstanceMetricSums as jest.Mock).mockResolvedValue({
            'i-1': { total: 1000, datapointCount: 2, unit: 'Bytes' },
            'i-2': { total: 2500, datapointCount: 1, unit: 'Bytes' },
            'i-3': { total: 40, datapointCount: 1, unit: 'Bytes' },
        });

        await service.readOperationJob(job(scheduleParameters));

        expect(getInstanceMetricSums).toHaveBeenCalledWith(
            expect.objectContaining({ metricName: 'NetworkOut', namespace: 'AWS/EC2', region: 'us-east-1' }),
        );
        const published = publishSpy.mock.calls.map(([call]) => call);
        expect(published).toHaveLength(2);
        expect(published).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    businessID: 'businessOne',
                    customerId: 'customerOne',
                    dimensionId: 'dimensionOne',
                    recordValue: 3500,
                    _measurement: UsageEntity._measurement,
                }),
                expect.objectContaining({
                    customerId: 'customerTwo',
                    dimensionId: 'dimensionOne',
                    recordValue: 40,
                }),
            ]),
        );
    });

    it('meters instances whatever their power state', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', { meteringcoDimensionId: 'dimensionOne', meteringcoCustomerId: 'customerOne' }, 'stopped'),
            instance('i-2', { meteringcoDimensionId: 'dimensionOne', meteringcoCustomerId: 'customerTwo' }, 'terminated'),
        ]);
        (getInstanceMetricSums as jest.Mock).mockResolvedValue({
            'i-1': { total: 700, datapointCount: 1 },
            'i-2': { total: 800, datapointCount: 1 },
        });

        await service.readOperationJob(job(scheduleParameters));

        // The filters sent to EC2 never narrow the search by instance state
        const [, , filters] = (getInstanceWithFilters as jest.Mock).mock.calls[0];
        expect(JSON.stringify(filters)).not.toContain('instance-state-name');
        const published = publishSpy.mock.calls.map(([call]) => call);
        expect(published.map(({ customerId, recordValue }) => ({ customerId, recordValue }))).toEqual(
            expect.arrayContaining([
                { customerId: 'customerOne', recordValue: 700 },
                { customerId: 'customerTwo', recordValue: 800 },
            ]),
        );
    });

    it('leaves out instances without a customer tag and instances metered on other dimensions', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', { meteringcoDimensionId: 'dimensionOne' }),
            instance('i-2', { meteringcoDimensionId: 'dimensionTwo', meteringcoCustomerId: 'customerTwo' }),
            instance('i-3', { meteringcoCustomerId: 'customerThree' }),
        ]);
        (getInstanceMetricSums as jest.Mock).mockResolvedValue({});

        await service.readOperationJob(job(scheduleParameters));

        expect(getInstanceMetricSums).not.toHaveBeenCalled();
        expect(publishSpy).not.toHaveBeenCalled();
    });

    it('does not record usage for a customer whose instances reported no observations', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', { meteringcoDimensionId: 'dimensionOne', meteringcoCustomerId: 'customerOne' }),
            instance('i-2', { meteringcoDimensionId: 'dimensionOne', meteringcoCustomerId: 'customerTwo' }),
        ]);
        (getInstanceMetricSums as jest.Mock).mockResolvedValue({
            'i-1': { total: 0, datapointCount: 3 },
            'i-2': { total: 0, datapointCount: 0 },
        });

        await service.readOperationJob(job(scheduleParameters));

        const published = publishSpy.mock.calls.map(([call]) => call);
        expect(published).toHaveLength(1);
        expect(published[0]).toEqual(expect.objectContaining({ customerId: 'customerOne', recordValue: 0 }));
    });

    it('rejects a run without an IAM role to assume', async () => {
        await expect(service.readOperationJob(job({ dimensionId: 'dimensionOne' }))).rejects.toThrow();
    });
});
