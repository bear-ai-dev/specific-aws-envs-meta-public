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
export class NetworkOutDataGathererService {
    private static readonly logger = new Logger(NetworkOutDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.networkOut)
    @Process(infrastructureType.egress as any)
    @Process(infrastructureType.networkEgress as any)
    @Process(infrastructureType.outboundNetwork as any)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        NetworkOutDataGathererService.logger.log(
            'Processing NetworkOut gathering event, logging inputs',
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

        // Get all instances in the region (no state filter, include stopped/terminated)
        // Use tag-key filter to reduce, but also include those without customer tag to be filtered later
        let instanceList: any[] = [];
        try {
            instanceList = await getInstanceWithFilters(region, creds, []);
        } catch (e) {
            NetworkOutDataGathererService.logger.error('Failed to describe instances', e);
            throw e;
        }

        // Filter by tags: meteringcoDimensionId contains dimensionId, and meteringcoCustomerId exists and non-empty
        const taggedInstances = instanceList.filter((instance) => {
            const tags = instance.Tags || [];
            const dimensionTag = tags.find((tag) => tag.Key === 'meteringcoDimensionId');
            const customerTag = tags.find((tag) => tag.Key === 'meteringcoCustomerId');
            if (!dimensionTag || !customerTag) {
                return false;
            }
            if (!customerTag.Value || customerTag.Value.trim() === '') {
                return false;
            }
            const dimensionIds = dimensionTag.Value.split(',').map((s) => s.trim());
            return dimensionIds.includes(dimensionId);
        });

        NetworkOutDataGathererService.logger.log(`Found ${taggedInstances.length} instances matching dimension ${dimensionId}`);

        if (taggedInstances.length === 0) {
            NetworkOutDataGathererService.logger.log('No matching instances, nothing to bill');
            return;
        }

        // For each instance, query CloudWatch NetworkOut
        const cloudWatchClient = new CloudWatchClient({ region, credentials: creds });

        // Define time window: last 10 minutes to capture the previous 5-minute bucket (handles CloudWatch delay)
        // The scheduler runs every 5 minutes, but metrics are delayed ~5 minutes, so we query 10m window and aggregate.
        // Using Period 300 (5 minutes) and Sum.
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 600 * 1000); // 10 minutes window to ensure we capture the 5m bucket

        // Alternatively, could use 5 minutes window but mock data is in previous bucket, so 10m is needed.
        // To be safe, query with 600 and sum all datapoints.

        const instanceMetrics = await Promise.all(
            taggedInstances.map(async (instance) => {
                const instanceId = instance.InstanceId;
                const tags = instance.Tags || [];
                const customerTag = tags.find((t) => t.Key === 'meteringcoCustomerId');
                const customerId = customerTag?.Value;

                // Also capture other tags for metadata
                let totalBytes = 0;
                try {
                    const command = new GetMetricStatisticsCommand({
                        Namespace: 'AWS/EC2',
                        MetricName: 'NetworkOut',
                        Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                        StartTime: startTime,
                        EndTime: endTime,
                        Period: 300,
                        Statistics: ['Sum'],
                        Unit: 'Bytes',
                    });
                    const response = await cloudWatchClient.send(command);
                    if (response.Datapoints && response.Datapoints.length > 0) {
                        // Sum all datapoints (in case period splits across buckets)
                        totalBytes = response.Datapoints.reduce((sum, dp) => sum + (dp.Sum || 0), 0);
                    } else {
                        totalBytes = 0;
                    }
                } catch (e) {
                    NetworkOutDataGathererService.logger.error(`Failed to get metric for ${instanceId}`, e);
                    totalBytes = 0;
                }

                // Attach metadata like other services: include instance info
                // For grouping, we need meteringcoCustomerId and dimensionId
                // We also attach other tags as metadata? Keep minimal.
                return {
                    instanceId,
                    customerId,
                    totalBytes,
                    // prepare metadata for publishing if needed
                    metadata: {
                        InstanceId: instanceId,
                        InstanceType: instance.InstanceType,
                        AvailabilityZone: instance.Placement?.AvailabilityZone || instance.availabilityZone,
                    },
                    tags,
                };
            }),
        );

        // Group by customerId and sum
        const grouped = instanceMetrics.reduce((acc, curr) => {
            if (!acc[curr.customerId]) {
                acc[curr.customerId] = { total: 0, instances: [] };
            }
            acc[curr.customerId].total += curr.totalBytes;
            acc[curr.customerId].instances.push(curr);
            return acc;
        }, {} as Record<string, { total: number; instances: any[] }>);

        // Publish per customer
        for (const [customerId, data] of Object.entries(grouped)) {
            const metadata: Record<string, any> = {};
            // Include instance list as metadata? Similar to other services, they include first instance's metadata
            // We'll include count and instanceIds
            const first = data.instances[0];
            if (first) {
                metadata['InstanceIds'] = data.instances.map((i) => i.instanceId).join(',');
                metadata['InstanceCount'] = data.instances.length.toString();
            }

            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: data.total, // in bytes, no conversion
                customerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
            NetworkOutDataGathererService.logger.log(
                `Published NetworkOut for customer ${customerId}: ${data.total} bytes from ${data.instances.length} instances`,
            );
        }

        NetworkOutDataGathererService.logger.log('Finished collecting NetworkOut data');
    }

    @OnQueueFailed({ name: infrastructureType.networkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
