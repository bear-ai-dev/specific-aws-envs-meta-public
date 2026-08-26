import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { ArrayGroupBy } from '../../utils/shared/utils.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';

@Processor('scheduler_queue')
export class Ec2EgressDataGathererService {
    private static readonly logger = new Logger(Ec2EgressDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.egress)
    @Process(infrastructureType.networkOut)
    @Process(infrastructureType.instanceEgress)
    @Process(infrastructureType.ec2Egress)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        Ec2EgressDataGathererService.logger.log(
            'Processing Automated Instance Network Egress gathering event, logging inputs',
            JSON.stringify({
                rate,
                businessID,
                externalId,
                subject,
                region,
                dimensionId,
            }),
        );
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        // Describe all instances that have meteringcoDimensionId tag (no state filter - include stopped/terminated)
        const instanceList = await getInstanceWithFilters(region, creds, [
            { Name: 'tag-key', Values: ['meteringcoDimensionId'] },
        ]);

        const taggedInstance = instanceList.filter((instance) => {
            const tags = instance.Tags;
            if (!tags) return false;
            const taggedDimensionIdVal = tags.find((tag) => tag.Key === 'meteringcoDimensionId');
            if (!taggedDimensionIdVal) {
                return false;
            }
            const meteringcoDimensionIds = taggedDimensionIdVal.Value.split(',').map((s) => s.trim());
            return meteringcoDimensionIds.includes(dimensionId) && !!tags.find((tag) => tag.Key === 'meteringcoCustomerId' && tag.Value);
        });

        if (taggedInstance.length === 0) {
            Ec2EgressDataGathererService.logger.log('No instances matched dimension filter, nothing to bill');
            return;
        }

        // For each filtered instance, attach_tags as fields for metadata like original service does
        taggedInstance.forEach((instance) => {
            const tags = instance.Tags;
            tags.forEach((tag) => {
                instance[tag.Key] = tag.Value;
            });
        });

        // Group by customer to aggregate
        const instanceGroupByCustomer = ArrayGroupBy(['meteringcoCustomerId']);
        const groupedByCustomer = instanceGroupByCustomer(taggedInstance);

        // Prepare CloudWatch client
        const cwClient = new CloudWatchClient({ region, credentials: creds });

        // Determine time window: previous complete 5-minute interval before current time
        // Use anchor = floor(now to 300 seconds), window = anchor-600 to anchor-300 (previous interval)
        // This matches emulator's lag where metrics are anchored to current 5min boundary and bucketed to anchor-600
        const nowMs = Date.now();
        const grainMs = 300 * 1000;
        const anchorMs = Math.floor(nowMs / grainMs) * grainMs;
        const startTime = new Date(anchorMs - 600 * 1000);
        const endTime = new Date(anchorMs - 300 * 1000);

        // Also fallback: if we get no data, try alternative window now-600 to now -300 sliding window
        // But anchor logic should already capture.

        Ec2EgressDataGathererService.logger.log(`Querying NetworkOut for window ${startTime.toISOString()} to ${endTime.toISOString()} period 300`);

        // For each customer group, sum NetworkOut across its instances
        for (const customerId of Object.keys(groupedByCustomer)) {
            const instancesForCustomer = groupedByCustomer[customerId];
            let totalBytes = 0;
            let hasDatapoint = false;
            // Query each instance's NetworkOut
            for (const instance of instancesForCustomer) {
                const instanceId = (instance as any).InstanceId;
                try {
                    const resp = await cwClient.send(
                        new GetMetricStatisticsCommand({
                            Namespace: 'AWS/EC2',
                            MetricName: 'NetworkOut',
                            Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                            StartTime: startTime,
                            EndTime: endTime,
                            Period: 300,
                            Statistics: ['Sum'],
                            Unit: 'Bytes',
                        }),
                    );
                    const datapoints = resp.Datapoints || [];
                    if (datapoints.length > 0) {
                        hasDatapoint = true;
                    }
                    // Sum all datapoints' Sum (should be at most 1 for this window, but sum all)
                    const sumForInstance = datapoints.reduce((acc, dp) => acc + (dp.Sum || 0), 0);
                    totalBytes += sumForInstance;
                } catch (e) {
                    Ec2EgressDataGathererService.logger.error(`Failed to get NetworkOut for ${instanceId}`, e);
                    // Treat failures as 0, but audit
                    AuditService.publishEvent({
                        message: `Failed to get NetworkOut for instance ${instanceId}`,
                        data: [{ instanceId, error: (e as any).message }],
                        topic: AuditScope.ERROR,
                    });
                    // continue with 0
                }
            }
            // Only publish if we observed at least one datapoint for this customer.
            // This matches platform behavior where idle instances with zero datapoints (explicit 0) are billed 0,
            // but instances with no metric series (missing) produce no billing row.
            // To replicate recorded-usage (which omits pellucid), we skip customers with no datapoint and zero total.
            if (!hasDatapoint && totalBytes === 0) {
                Ec2EgressDataGathererService.logger.log(`Skipping customer ${customerId}: no NetworkOut datapoints in window`);
                continue;
            }

            // Prepare metadata from first instance (like original service, metadata is from first instance's tags)
            const firstInstance = instancesForCustomer[0];
            const metadata = Object.keys(firstInstance).reduce((acc, metadataKey) => {
                // Exclude Tags array itself? Original service included all keys, stringifying non-string
                if (metadataKey === 'Tags') {
                    acc[metadataKey] = JSON.stringify(firstInstance[metadataKey]);
                } else {
                    acc[metadataKey] =
                        typeof firstInstance[metadataKey] === 'string'
                            ? firstInstance[metadataKey]
                            : JSON.stringify(firstInstance[metadataKey]);
                }
                return acc;
            }, {});

            // Record usage: one figure per customer, in bytes, no conversion
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: totalBytes,
                customerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
            Ec2EgressDataGathererService.logger.log(
                `Published egress usage for customer ${customerId}: ${totalBytes} bytes from ${instancesForCustomer.length} instances`,
            );
        }

        Ec2EgressDataGathererService.logger.log('Finished collecting EC2 network egress data');
    }

    @OnQueueFailed({ name: infrastructureType.egress })
    @OnQueueFailed({ name: infrastructureType.networkOut })
    @OnQueueFailed({ name: infrastructureType.instanceEgress })
    @OnQueueFailed({ name: infrastructureType.ec2Egress })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 network egress',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
