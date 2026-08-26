import { Tag } from '@aws-sdk/client-ec2';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { BadRequestException, Logger } from '@nestjs/common';
import { Job } from 'bull';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { getNetworkOutBytesByInstance } from '../../utils/aws/awsCloudWatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { Ec2NetworkOutDataGathererDto } from './Dto/ec2NetworkOutDataGatherer.dto.js';

/**
 * Turns the outbound network traffic of the instances in a metered account into
 * billable usage: the bytes each customer's instances sent out, one record value
 * per customer for the dimension the run is for.
 */
@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);
    /**
     * EC2 publishes `NetworkOut` to CloudWatch on a five minute grain and a period
     * only lands a few minutes after it closes, so the window read here trails the
     * clock by more than the single interval the schedule runs on.
     */
    private static readonly measurementWindowInMilliseconds = 15 * 60 * 1000;
    constructor() {}

    @Process(infrastructureType.instanceNetworkOutBytes)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters as Ec2NetworkOutDataGathererDto;
        Ec2NetworkOutDataGathererService.logger.log(
            'Processing Automated EC2 network out gathering event, logging inputs',
            JSON.stringify({
                rate,
                businessID,
                externalId,
                dimensionId,
                region,
                subject,
            }),
        );
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });
        // Power state is none of this measurement's business: an instance that has
        // since been stopped or terminated still sent whatever it sent while it was
        // up, so no instance-state filter is applied here.
        const instanceList = await getInstanceWithFilters(region, creds, [
            { Name: 'tag-key', Values: ['meteringcoDimensionId'] },
        ]);
        const meteredInstances: Array<{ InstanceId: string; Tags: Tag[] }> = instanceList.filter(({ Tags }) =>
            Ec2NetworkOutDataGathererService.isMeteredOn(Tags, dimensionId),
        );
        Ec2NetworkOutDataGathererService.logger.log(
            `Found ${meteredInstances.length} instances metered on dimension ${dimensionId}`,
        );
        const endTime = new Date();
        const startTime = new Date(
            endTime.getTime() - Ec2NetworkOutDataGathererService.measurementWindowInMilliseconds,
        );
        const networkOutBytesByInstance = await getNetworkOutBytesByInstance({
            region,
            credentials: creds,
            instanceIds: meteredInstances.map(({ InstanceId }) => InstanceId),
            startTime,
            endTime,
        });
        // Several instances of the same customer add into that customer's single figure
        const networkOutBytesByCustomer = meteredInstances.reduce(
            (bytesSentPerCustomer: Record<string, number>, { InstanceId, Tags }) => {
                const bytesSent = networkOutBytesByInstance[InstanceId];
                if (bytesSent === undefined) {
                    // The instance never reported the series over the window
                    return bytesSentPerCustomer;
                }
                const { meteringcoCustomerId } = StandardMeasurementEntity.awsTagKeyReducer(Tags);
                bytesSentPerCustomer[meteringcoCustomerId] = (bytesSentPerCustomer[meteringcoCustomerId] ?? 0) + bytesSent;
                return bytesSentPerCustomer;
            },
            {},
        );
        Object.entries(networkOutBytesByCustomer).forEach(([customerId, recordValue]) => {
            // The record value is the bytes sent, neither rounded nor scaled to a larger unit
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                customerId,
                recordValue,
                metadata: { region },
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });
        Ec2NetworkOutDataGathererService.logger.log(
            'Finished collecting EC2 network out data',
            JSON.stringify({ businessID, dimensionId, customers: Object.keys(networkOutBytesByCustomer).length }),
        );
    }

    /**
     * An instance is part of a run when it names the customer it belongs to and its
     * comma separated list of dimensions holds the dimension being billed.
     */
    private static isMeteredOn(Tags: Tag[], dimensionId: string): boolean {
        const { meteringcoCustomerId, meteringcoDimensionId } = StandardMeasurementEntity.awsTagKeyReducer(Tags);
        if (!meteringcoCustomerId || !meteringcoCustomerId.trim()) {
            return false;
        }
        return (meteringcoDimensionId ? meteringcoDimensionId.split(',') : [])
            .map((taggedDimensionId: string) => taggedDimensionId.trim())
            .includes(dimensionId);
    }

    @OnQueueFailed({ name: infrastructureType.instanceNetworkOutBytes })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 instance network out',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
