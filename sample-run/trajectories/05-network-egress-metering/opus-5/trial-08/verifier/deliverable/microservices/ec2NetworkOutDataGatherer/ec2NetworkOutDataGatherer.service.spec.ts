import { Job } from 'bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { getNetworkOutBytesByInstance } from '../../utils/aws/awsCloudWatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';

jest.mock('../../utils/aws/awsEc2.js', () => ({ getInstanceWithFilters: jest.fn() }));
jest.mock('../../utils/aws/awsCloudWatch.js', () => ({ getNetworkOutBytesByInstance: jest.fn() }));
jest.mock('@aws-sdk/credential-providers', () => ({ fromTemporaryCredentials: jest.fn().mockReturnValue('creds') }));

const instance = (InstanceId: string, dimensionTag?: string, customerTag?: string, state = 'running') => ({
    InstanceId,
    State: { Name: state },
    Tags: [
        { Key: 'Name', Value: InstanceId },
        ...(dimensionTag === undefined ? [] : [{ Key: 'meteringcoDimensionId', Value: dimensionTag }]),
        ...(customerTag === undefined ? [] : [{ Key: 'meteringcoCustomerId', Value: customerTag }]),
    ],
});

describe('Ec2NetworkOutDataGathererService', () => {
    const service = new Ec2NetworkOutDataGathererService();
    const scheduleParameters = {
        dimensionType: infrastructureType.instanceNetworkOutBytes,
        iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-egress-reader',
        externalId: 'nw-sbx-4417',
        dimensionId: 'dim_egress',
        region: 'us-east-1',
    };
    const job = {
        data: { scheduleParameters, businessID: 'biz-1', subject: 'sub', rate: '*/5 * * * *' },
    } as Job<SchedulerEntity>;
    let publish: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();
        publish = jest.spyOn(StandardMeasurementEntity, 'publish').mockImplementation(() => undefined);
    });
    afterEach(() => publish.mockRestore());

    it('bills each customer the bytes all of its instances sent out', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', 'dim_egress', 'cus_a'),
            instance('i-2', 'dim_other,dim_egress', 'cus_a'),
            instance('i-3', 'dim_egress', 'cus_b', 'stopped'),
            instance('i-4', 'dim_egress', 'cus_c', 'terminated'),
        ]);
        (getNetworkOutBytesByInstance as jest.Mock).mockResolvedValue({
            'i-1': 1500.5,
            'i-2': 2000,
            'i-3': 0,
            'i-4': 640000,
        });

        await service.readOperationJob(job);

        // Instance state is irrelevant, the bytes were sent either way, and the
        // record value stays the raw byte count of the whole customer
        expect(publish).toHaveBeenCalledTimes(3);
        expect(publish.mock.calls.map(([measurement]) => measurement)).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    businessID: 'biz-1',
                    dimensionId: 'dim_egress',
                    customerId: 'cus_a',
                    recordValue: 3500.5,
                    _measurement: UsageEntity._measurement,
                }),
                expect.objectContaining({ customerId: 'cus_b', recordValue: 0 }),
                expect.objectContaining({ customerId: 'cus_c', recordValue: 640000 }),
            ]),
        );
    });

    it('leaves out instances without a customer or without the dimension of the run', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', 'dim_egress'),
            instance('i-2', 'dim_egress', ''),
            instance('i-3', 'dim_other', 'cus_a'),
            instance('i-4', undefined, 'cus_a'),
        ]);
        (getNetworkOutBytesByInstance as jest.Mock).mockResolvedValue({});

        await service.readOperationJob(job);

        expect((getNetworkOutBytesByInstance as jest.Mock).mock.calls[0][0].instanceIds).toEqual([]);
        expect(publish).not.toHaveBeenCalled();
    });

    it('does not bill a customer whose instances reported no traffic at all', async () => {
        (getInstanceWithFilters as jest.Mock).mockResolvedValue([
            instance('i-1', 'dim_egress', 'cus_a'),
            instance('i-2', 'dim_egress', 'cus_silent'),
        ]);
        (getNetworkOutBytesByInstance as jest.Mock).mockResolvedValue({ 'i-1': 10 });

        await service.readOperationJob(job);

        expect(publish).toHaveBeenCalledTimes(1);
        expect(publish.mock.calls[0][0]).toEqual(expect.objectContaining({ customerId: 'cus_a', recordValue: 10 }));
    });

    it('rejects a run that carries no role to assume', async () => {
        await expect(
            service.readOperationJob({
                data: { ...job.data, scheduleParameters: { region: 'us-east-1' } },
            } as Job<SchedulerEntity>),
        ).rejects.toThrow('Iam role arn not found');
    });
});
