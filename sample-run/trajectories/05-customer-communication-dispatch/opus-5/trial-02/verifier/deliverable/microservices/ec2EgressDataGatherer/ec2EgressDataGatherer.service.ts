import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { getEc2Egress } from '../../utils/aws/cloudwatch.js';
import { ArrayGroupBy } from '../../utils/shared/utils.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

@Processor('scheduler_queue')
export class Ec2EgressDataGathererService {
    private static readonly logger = new Logger(Ec2EgressDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.ec2Egress)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        Ec2EgressDataGathererService.logger.log('Processing automated EC2 esgress gathering event, logging inputs', {
            rate,
            businessID,
            externalId,
            subject,
        });
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });
        const instanceList = await getInstanceWithFilters(region, creds, [
            { Name: 'tag-key', Values: ['meteringcoDimensionId'] },
        ]);
        const idMetadataMap = {};
        instanceList
            .filter((instance) => {
                const tags = instance.Tags;
                const taggedDimensionIdVal = tags.find((tag) => tag.Key === 'meteringcoDimensionId');
                if (!taggedDimensionIdVal) {
                    return false;
                }
                const meteringcoDimensionIds = taggedDimensionIdVal.Value.split(',');
                return meteringcoDimensionIds.includes(dimensionId) && !!tags.find((tag) => tag.Key === 'meteringcoCustomerId');
            })
            .forEach((instance) => {
                instance.Tags.forEach((tag) => {
                    instance[tag.Key] = tag.Value;
                });
                idMetadataMap[instance.InstanceId] = instance;
            });
        const instanceEgressList: {
            meteringcoDimensionId: string;
            meteringcoCustomerId: string;
            egress: number;
        }[] = [];
        (
            await getEc2Egress(
                region,
                creds,
                new Date(Date.now() - 11 * 60 * 1000),
                new Date(Date.now() - 5 * 60 * 1000),
                Object.keys(idMetadataMap),
            )
        ).forEach((metricDataResult) => {
            idMetadataMap[metricDataResult.Id].egress = metricDataResult.Values[metricDataResult.Values.length - 1];
            instanceEgressList.push(idMetadataMap[metricDataResult.Id]);
        });
        const instanceGroupByTags = ArrayGroupBy(['meteringcoDimensionId', 'meteringcoCustomerId']);
        const groupedInstances = instanceGroupByTags(instanceEgressList);
        Object.keys(groupedInstances).forEach((tagCombinaton) => {
            const egressBytesTotal = groupedInstances[tagCombinaton].reduce(
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                (acc, instance) => acc + instance.egress,
                0.0,
            );
            // Use first instance's metadata as the aggregated metadata for now
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
                recordValue: egressBytesTotal,
                customerId: groupedInstances[tagCombinaton][0].meteringcoCustomerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });
        Ec2EgressDataGathererService.logger.log('Finished collecting EC2 egress data');
    }

    @OnQueueFailed({ name: infrastructureType.ec2Egress })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 egress data',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
