import { getInstanceMetricTotals } from '../../utils/aws/awsCloudwatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';

jest.mock('../../utils/aws/awsEc2.js', () => ({ getInstanceWithFilters: jest.fn() }));
jest.mock('../../utils/aws/awsCloudwatch.js', () => ({ getInstanceMetricTotals: jest.fn() }));
jest.mock('@aws-sdk/credential-providers', () => ({ fromTemporaryCredentials: jest.fn(() => 'creds') }));

const dimensionId = 'dimension-being-billed';
const businessID = 'business-1';

const instance = (InstanceId: string, tags: Record<string, string>, state = 'running') => ({
    InstanceId,
    State: { Name: state },
    Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })),
});

const job = () =>
    ({
        data: {
            businessID,
            subject: 'subject-1',
            rate: '0 */5 * * * *',
            scheduleParameters: {
                dimensionType: infrastructureType.ec2NetworkOut,
                iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-reader',
                externalId: 'external-id',
                dimensionId,
                region: 'us-east-1',
            },
        },
    }) as any;

describe('Ec2NetworkOutDataGathererService', () => {
    let service: Ec2NetworkOutDataGathererService;
    let publish: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        service = new Ec2NetworkOutDataGathererService();
        publish = jest
            .spyOn(StandardMeasurementEntity, 'publish')
            .mockImplementation((measurement) => ({ message: 'published', id: 'id', data: [measurement] }) as any);
    });

    afterAll(() => {
        jest.restoreAllMocks();
    });

    it('meters the window as one whole five minute period, held back for the observations to land', () => {
        const { startTime, endTime } = Ec2NetworkOutDataGathererService.measurementWindow(
            new Date('2024-05-01T10:03:21.000Z'),
        );
        expect(startTime.toISOString()).toBe('2024-05-01T09:50:00.000Z');
        expect(endTime.toISOString()).toBe('2024-05-01T09:55:00.000Z');
    });

    it('bills every customer for the bytes their instances sent out, whatever state they are in', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'customer-a' }),
            instance('i-2', { meteringcoDimensionId: `other-dimension,${dimensionId}`, meteringcoCustomerId: 'customer-a' }),
            instance('i-3', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'customer-b' }, 'terminated'),
            instance('i-4', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'customer-c' }, 'stopped'),
        ]);
        (getInstanceMetricTotals as jest.Mock).mockResolvedValue({
            'i-1': { total: 1024, observed: true },
            'i-2': { total: 512.5, observed: true },
            'i-3': { total: 2048, observed: true },
            'i-4': { total: 0, observed: true },
        });

        await service.readOperationJob(job());

        expect(getInstanceMetricTotals).toHaveBeenCalledWith(
            expect.objectContaining({
                metricName: 'NetworkOut',
                region: 'us-east-1',
                instanceIds: ['i-1', 'i-2', 'i-3', 'i-4'],
                periodInSeconds: 300,
            }),
        );
        const usage = publish.mock.calls.map(([{ customerId, dimensionId: billedDimension, recordValue }]) => ({
            customerId,
            dimensionId: billedDimension,
            recordValue,
        }));
        expect(usage).toEqual(
            expect.arrayContaining([
                { customerId: 'customer-a', dimensionId, recordValue: 1536.5 },
                { customerId: 'customer-b', dimensionId, recordValue: 2048 },
                { customerId: 'customer-c', dimensionId, recordValue: 0 },
            ]),
        );
        expect(usage).toHaveLength(3);
        expect(publish.mock.calls[0][0]).toEqual(
            expect.objectContaining({ businessID, _measurement: UsageEntity._measurement }),
        );
    });

    it('leaves out instances without a customer, on other dimensions, or with no observation', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', { meteringcoDimensionId: dimensionId }),
            instance('i-2', { meteringcoDimensionId: 'another-dimension', meteringcoCustomerId: 'customer-b' }),
            instance('i-3', { meteringcoDimensionId: dimensionId, meteringcoCustomerId: 'customer-c' }),
        ]);
        (getInstanceMetricTotals as jest.Mock).mockResolvedValue({
            'i-3': { total: 0, observed: false },
        });

        await service.readOperationJob(job());

        expect(publish).not.toHaveBeenCalled();
    });
});
