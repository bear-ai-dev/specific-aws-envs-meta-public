import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { ArrayGroupBy } from '../../utils/shared/utils.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { InfluxService } from '../../influx/influx.service.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

@Processor('scheduler_queue')
export class Ec2InstanceDataGathererService {
    private static readonly logger = new Logger(Ec2InstanceDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.instanceRunningTime)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        Ec2InstanceDataGathererService.logger.log(
            'Processing Automated Instance Uptime gathering event, logging inputs',
            JSON.stringify({
                rate,
                businessID,
                externalId,
                subject,
            }),
        );
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });
        const instanceList = await getInstanceWithFilters(region, creds, [
            { Name: 'instance-state-name', Values: ['running'] },
            { Name: 'tag-key', Values: ['meteringcoDimensionId'] },
        ]);
        const taggedInstance = instanceList.filter((instance) => {
            const tags = instance.Tags;
            const taggedDimensionIdVal = tags.find((tag) => tag.Key === 'meteringcoDimensionId');
            if (!taggedDimensionIdVal) {
                return false;
            }
            const meteringcoDimensionIds = taggedDimensionIdVal.Value.split(',');
            return meteringcoDimensionIds.includes(dimensionId) && !!tags.find((tag) => tag.Key === 'meteringcoCustomerId');
        });
        taggedInstance.forEach((instance) => {
            const tags = instance.Tags;
            tags.forEach((tag) => {
                instance[tag.Key] = tag.Value;
            });
        });
        const instanceGroupByTags = ArrayGroupBy(['meteringcoDimensionId', 'meteringcoCustomerId']);
        const groupedInstances = instanceGroupByTags(taggedInstance);
        Object.keys(groupedInstances).forEach((tagCombinaton) => {
            const runningTimeIncrement = 0.08333333; // TODO: make this dynamic
            const runningTimeTotal = groupedInstances[tagCombinaton].length * runningTimeIncrement;
            const metadata = Object.keys(groupedInstances[tagCombinaton][0]).reduce((acc, metadataKey) => {
                acc[metadataKey] =
                    typeof groupedInstances[tagCombinaton][0][metadataKey] === 'string'
                        ? groupedInstances[tagCombinaton][0][metadataKey]
                        : JSON.stringify(groupedInstances[tagCombinaton][0][metadataKey]);
                return acc;
            }, {});
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: runningTimeTotal,
                customerId: groupedInstances[tagCombinaton][0].meteringcoCustomerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });
        Ec2InstanceDataGathererService.logger.log('Finished collecting EC2 instance running time data');
    }

    @OnQueueFailed({ name: infrastructureType.instanceRunningTime })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 instance running time',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
