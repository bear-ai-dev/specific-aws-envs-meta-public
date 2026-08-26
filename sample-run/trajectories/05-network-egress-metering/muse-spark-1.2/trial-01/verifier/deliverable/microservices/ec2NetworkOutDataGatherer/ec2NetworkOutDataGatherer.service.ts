import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
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
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.ec2NetworkOut)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        Ec2NetworkOutDataGathererService.logger.log(
            'Processing Automated EC2 Network Out gathering event, logging inputs',
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

        // Get all instances in the region (do NOT filter by running, include stopped/terminated)
        const instanceList = await getInstanceWithFilters(region, creds, []);

        const taggedInstance = instanceList.filter((instance) => {
            const tags = instance.Tags || [];
            const taggedDimensionIdVal = tags.find((tag) => tag.Key === 'meteringcoDimensionId');
            if (!taggedDimensionIdVal) {
                return false;
            }
            const meteringcoDimensionIds = taggedDimensionIdVal.Value.split(',').map((s) => s.trim());
            const hasDimension = meteringcoDimensionIds.includes(dimensionId);
            const hasCustomer = !!tags.find((tag) => tag.Key === 'meteringcoCustomerId' && tag.Value && tag.Value.trim() !== '');
            return hasDimension && hasCustomer;
        });

        Ec2NetworkOutDataGathererService.logger.log(`Found ${taggedInstance.length} instances matching dimension ${dimensionId}`);

        // Group by customer for aggregation
        const customerTotals: Record<string, number> = {};
        const customerMetadata: Record<string, any> = {};

        const cwClient = new CloudWatchClient({ region, credentials: creds });

        // Determine time window: CloudWatch observations are 5-10 minutes old, aligned to 5-min boundaries.
        // The most recent finished 5-min bucket that contains data is [anchor-600, anchor-300),
        // where anchor = floor(now/300)*300 (the current 5-min boundary).
        // To reliably capture it regardless of when we run within the 5-min interval,
        // query the delayed 5-min window. Using a 10-min window also works because the
        // extra 5-min bucket is empty, but we prefer the precise delayed window.
        const now = new Date();
        const anchorMs = Math.floor(now.getTime() / 1000 / 300) * 300 * 1000;
        // Primary: delayed 5-min interval [anchor-600, anchor-300)
        let queryStart = new Date(anchorMs - 600 * 1000);
        let queryEnd = new Date(anchorMs - 300 * 1000);
        // Fallback: if anchor calc yields no data (e.g., clock skew), widen to last 10 minutes
        // We keep anchor window as primary as it matches the interval semantics.

        for (const instance of taggedInstance) {
            const instanceId = instance.InstanceId;
            const custTag = instance.Tags.find((t) => t.Key === 'meteringcoCustomerId');
            const customerId = custTag.Value;

            // Prepare metadata for this customer (from first instance of that customer)
            if (!customerMetadata[customerId]) {
                const tags = instance.Tags;
                const meta: any = {};
                // store minimal metadata
                tags.forEach((tag) => {
                    // avoid overwriting
                    meta[tag.Key] = tag.Value;
                });
                meta.InstanceId = instanceId;
                customerMetadata[customerId] = meta;
            }

            let sum = 0;
            try {
                const resp = await cwClient.send(
                    new GetMetricStatisticsCommand({
                        Namespace: 'AWS/EC2',
                        MetricName: 'NetworkOut',
                        Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                        StartTime: queryStart,
                        EndTime: queryEnd,
                        Period: 300,
                        Statistics: ['Sum'],
                        Unit: 'Bytes',
                    }),
                );
                if (resp.Datapoints && resp.Datapoints.length > 0) {
                    for (const dp of resp.Datapoints) {
                        // Sum field
                        if (typeof dp.Sum === 'number') {
                            sum += dp.Sum;
                        } else if (typeof (dp as any).Sum === 'string') {
                            sum += parseFloat((dp as any).Sum);
                        }
                    }
                } else {
                    // No datapoints means no traffic (or missing series) -> 0
                    sum = 0;
                }
                Ec2NetworkOutDataGathererService.logger.log(`Instance ${instanceId} customer ${customerId} NetworkOut sum ${sum} for window ${queryStart.toISOString()} - ${queryEnd.toISOString()} datapoints ${resp.Datapoints.length}`);
            } catch (e) {
                Ec2NetworkOutDataGathererService.logger.error(`Failed to get NetworkOut for ${instanceId}`, e);
                AuditService.publishEvent({
                    message: 'Failed to get NetworkOut for instance',
                    data: [{ instanceId, error: e }],
                    topic: AuditScope.ERROR,
                });
                sum = 0;
            }

            customerTotals[customerId] = (customerTotals[customerId] || 0) + sum;
        }

        for (const [customerId, totalBytes] of Object.entries(customerTotals)) {
            const metadata = customerMetadata[customerId] || {};
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: totalBytes,
                customerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        }

        Ec2NetworkOutDataGathererService.logger.log('Finished collecting EC2 Network Out data');
    }

    // Alias handlers for alternative names
    @Process(infrastructureType.networkOut)
    async readOperationJobNetworkOut(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    @Process(infrastructureType.ec2NetworkBytesOut)
    async readOperationJobBytesOut(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    @OnQueueFailed({ name: infrastructureType.ec2NetworkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 Network Out',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.networkOut })
    jobFailureNetworkOut(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 Network Out (networkOut)',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.ec2NetworkBytesOut })
    jobFailureBytesOut(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 Network Out (bytes)',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
