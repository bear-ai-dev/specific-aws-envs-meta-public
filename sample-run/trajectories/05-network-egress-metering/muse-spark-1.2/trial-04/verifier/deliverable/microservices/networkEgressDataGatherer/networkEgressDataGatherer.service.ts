import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

@Processor('scheduler_queue')
export class NetworkEgressDataGathererService {
    private static readonly logger = new Logger(NetworkEgressDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.networkEgress)
    async handleNetworkEgress({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data: { scheduleParameters, businessID, subject, rate } } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.instanceNetworkEgress)
    async handleInstanceNetworkEgress({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data: { scheduleParameters, businessID, subject, rate } } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.ec2NetworkEgress)
    async handleEc2NetworkEgress({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data: { scheduleParameters, businessID, subject, rate } } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.networkOut)
    async handleNetworkOut({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data: { scheduleParameters, businessID, subject, rate } } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.ec2NetworkOut)
    async handleEc2NetworkOut({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data: { scheduleParameters, businessID, subject, rate } } as Job<SchedulerEntity>);
    }

    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        NetworkEgressDataGathererService.logger.log(
            'Processing Network Egress gathering event',
            JSON.stringify({
                rate,
                businessID,
                externalId,
                subject,
                dimensionId,
                region,
            }),
        );
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        // Describe instances in the specified region, without filtering by state (include stopped/terminated)
        // We filter only by tag-key to reduce result set, then further filter in code
        let instanceList: any[] = [];
        try {
            instanceList = await getInstanceWithFilters(region, creds, [
                { Name: 'tag-key', Values: ['meteringcoDimensionId'] },
            ]);
        } catch (e) {
            NetworkEgressDataGathererService.logger.error('Failed to describe instances', e);
            throw e;
        }

        const taggedInstances = instanceList.filter((instance) => {
            const tags = instance.Tags || [];
            const dimTag = tags.find((t: any) => t.Key === 'meteringcoDimensionId');
            if (!dimTag) return false;
            const dimIds = dimTag.Value.split(',').map((s: string) => s.trim());
            const hasDimension = dimIds.includes(dimensionId);
            const hasCustomer = !!tags.find((t: any) => t.Key === 'meteringcoCustomerId');
            return hasDimension && hasCustomer;
        });

        if (taggedInstances.length === 0) {
            NetworkEgressDataGathererService.logger.log('No tagged instances found for dimension', dimensionId);
            return;
        }

        // Prepare CloudWatch client
        const cwClient = new CloudWatchClient({ region, credentials: creds });

        // Time window: last 10 minutes to capture last finished 5-min bucket due to CloudWatch delay / emulator alignment
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 10 * 60 * 1000);

        // Aggregate per customer
        const customerTotals: Record<string, number> = {};
        const customerHasData: Record<string, boolean> = {};

        for (const instance of taggedInstances) {
            const tags = instance.Tags || [];
            const customerTag = tags.find((t: any) => t.Key === 'meteringcoCustomerId');
            if (!customerTag) continue;
            const customerId = customerTag.Value;
            const instanceId = instance.InstanceId;

            // Query CloudWatch for NetworkOut Sum over window
            try {
                const cmd = new GetMetricStatisticsCommand({
                    Namespace: 'AWS/EC2',
                    MetricName: 'NetworkOut',
                    Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                    StartTime: startTime,
                    EndTime: endTime,
                    Period: 300,
                    Statistics: ['Sum'],
                    Unit: 'Bytes',
                });
                const resp = await cwClient.send(cmd);
                const datapoints = resp.Datapoints || [];
                if (datapoints.length === 0) {
                    // No data for this instance in window -> treat as silent, not zero
                    continue;
                }
                // Only consider the most recent bucket to avoid double counting when window is larger than period (e.g., 10min window for 5min period)
                // Find latest timestamp
                const sorted = [...datapoints].sort((a, b) => new Date(b.Timestamp as any).getTime() - new Date(a.Timestamp as any).getTime());
                const latestTime = sorted[0].Timestamp ? new Date(sorted[0].Timestamp as any).getTime() : null;
                const latestPoints = latestTime !== null ? datapoints.filter(dp => dp.Timestamp && new Date(dp.Timestamp as any).getTime() === latestTime) : datapoints;
                let sum = 0;
                let hasData = false;
                for (const dp of latestPoints) {
                    if (dp.Sum !== undefined && dp.Sum !== null) {
                        sum += dp.Sum;
                        hasData = true;
                    }
                }
                if (!hasData) {
                    continue;
                }
                // Accumulate per customer
                if (!(customerId in customerTotals)) {
                    customerTotals[customerId] = 0;
                    customerHasData[customerId] = false;
                }
                customerTotals[customerId] += sum;
                customerHasData[customerId] = true;
            } catch (e) {
                NetworkEgressDataGathererService.logger.error(`Failed to get metrics for ${instanceId}`, e);
                // Continue to next instance, don't fail whole job for one instance
            }
        }

        // Publish one measurement per customer that had data (including zero where datapoints existed with Sum 0)
        Object.keys(customerTotals).forEach((customerId) => {
            if (!customerHasData[customerId]) return;
            const total = customerTotals[customerId];
            // Find a representative metadata from instances for this customer (first instance)
            const rep = taggedInstances.find((inst) => {
                const t = (inst.Tags || []).find((x: any) => x.Key === 'meteringcoCustomerId');
                return t && t.Value === customerId;
            });
            const metadata: Record<string, string> = {};
            if (rep) {
                // include instanceId as metadata for traceability
                metadata.instanceId = rep.InstanceId;
                // also include tags as metadata
                (rep.Tags || []).forEach((tag: any) => {
                    metadata[tag.Key] = tag.Value;
                });
            }
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: total,
                customerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });

        NetworkEgressDataGathererService.logger.log('Finished collecting Network Egress data', {
            customerCount: Object.keys(customerTotals).length,
            instanceCount: taggedInstances.length,
        });
    }

    @OnQueueFailed({ name: infrastructureType.networkEgress })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure Network Egress',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.instanceNetworkEgress })
    jobFailure2(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure Instance Network Egress',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.ec2NetworkEgress })
    jobFailure3(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 Network Egress',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.networkOut })
    jobFailure4(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.ec2NetworkOut })
    jobFailure5(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 NetworkOut',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
