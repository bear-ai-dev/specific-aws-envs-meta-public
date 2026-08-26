import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { getNetworkOutBytesForInstances } from '../../utils/aws/awsCloudWatch.js';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';

jest.mock('@aws-sdk/credential-providers', () => ({
    fromTemporaryCredentials: jest.fn(() => 'assumed-role-credentials'),
}));
jest.mock('../../utils/aws/awsEc2.js', () => ({
    getInstanceWithFilters: jest.fn(),
}));
jest.mock('../../utils/aws/awsCloudWatch.js', () => ({
    ...jest.requireActual('../../utils/aws/awsCloudWatch.js'),
    getNetworkOutBytesForInstances: jest.fn(),
}));

const dimensionId = 'dim-egress';
const instance = (InstanceId: string, tags: Record<string, string>, state = 'running') => ({
    InstanceId,
    InstanceType: 'm5.large',
    State: { Name: state },
    Placement: { AvailabilityZone: 'us-east-1a' },
    Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
});

const job = (overrides = {}) =>
    ({
        data: {
            businessID: 'biz-1',
            subject: 'user-1',
            rate: '0 */5 * * * *',
            scheduleParameters: {
                dimensionType: infrastructureType.instanceNetworkOut,
                iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-egress-reader',
                externalId: 'external-id',
                region: 'us-east-1',
                dimensionId,
                ...overrides,
            },
        },
    }) as any;

describe('Ec2NetworkOutDataGathererService', () => {
    let service: Ec2NetworkOutDataGathererService;
    let publish: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new Ec2NetworkOutDataGathererService();
        publish = jest.spyOn(StandardMeasurementEntity, 'publish').mockImplementation((request) => ({
            message: 'published',
            id: 'id',
            data: [request],
        }));
    });

    it('bills each customer the bytes its machines sent, regardless of power state', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'cus-a' }),
            instance('i-2', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'cus-a' }, 'stopped'),
            instance('i-3', { meteringcoDimensionId: `other-dim,${dimensionId}`, meteringcoCustomerId: 'cus-b' }, 'terminated'),
        ]);
        (getNetworkOutBytesForInstances as jest.Mock).mockResolvedValue({
            'i-1': { total: 1234567, datapointCount: 1 },
            'i-2': { total: 7654321, datapointCount: 1 },
            'i-3': { total: 555, datapointCount: 2 },
        });

        const measurements = await service.readOperationJob(job());

        expect(getInstanceWithFilters).toHaveBeenCalledWith('us-east-1', 'assumed-role-credentials', [
            { Name: 'tag-key', Values: ['meteringcoDimensionId'] },
        ]);
        expect(publish).toHaveBeenCalledTimes(2);
        expect(
            measurements.map(({ customerId, recordValue, dimensionId: recordedDimension, _measurement }) => ({
                customerId,
                recordValue,
                recordedDimension,
                _measurement,
            })),
        ).toEqual([
            {
                customerId: 'cus-a',
                // The two machines of the customer add into a single figure, in bytes
                recordValue: 1234567 + 7654321,
                recordedDimension: dimensionId,
                _measurement: UsageEntity._measurement,
            },
            {
                customerId: 'cus-b',
                recordValue: 555,
                recordedDimension: dimensionId,
                _measurement: UsageEntity._measurement,
            },
        ]);
    });

    it('leaves out machines with no customer tag and machines not metered on the dimension', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-untagged', { meteringcoDimensionId: dimensionId }),
            instance('i-other', { meteringcoDimensionId: 'another-dim', meteringcoCustomerId: 'cus-c' }),
            instance('i-billed', { meteringcoDimensionId: `${dimensionId},another-dim`, meteringcoCustomerId: 'cus-d' }),
        ]);
        (getNetworkOutBytesForInstances as jest.Mock).mockResolvedValue({
            'i-billed': { total: 42, datapointCount: 1 },
        });

        const measurements = await service.readOperationJob(job());

        expect(getNetworkOutBytesForInstances).toHaveBeenCalledWith(
            expect.objectContaining({ instanceIds: ['i-billed'] }),
        );
        expect(measurements).toHaveLength(1);
        expect(measurements[0].customerId).toEqual('cus-d');
    });

    it('records nothing for a customer CloudWatch held no observation for', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-idle', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'cus-idle' }),
            instance('i-silent', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'cus-silent' }),
        ]);
        (getNetworkOutBytesForInstances as jest.Mock).mockResolvedValue({
            // An idle machine reports zero, which is billable as zero
            'i-idle': { total: 0, datapointCount: 1 },
            // A machine nothing was observed for is not a machine that sent zero bytes
            'i-silent': { total: 0, datapointCount: 0 },
        });

        const measurements = await service.readOperationJob(job());

        expect(measurements).toHaveLength(1);
        expect(measurements[0]).toEqual(expect.objectContaining({ customerId: 'cus-idle', recordValue: 0 }));
    });

    it('rejects a run without the role to assume', async () => {
        await expect(service.readOperationJob(job({ iamRoleArn: undefined }))).rejects.toThrow();
        expect(publish).not.toHaveBeenCalled();
    });
});
