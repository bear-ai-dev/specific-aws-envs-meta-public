import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';

@Processor('scheduler_queue')
export class NetworkOutDataGathererService {
    private static readonly logger = new Logger(NetworkOutDataGathererService.name);
    constructor() {}

    // Handle all possible dimensionType aliases for network egress
    @Process(infrastructureType.networkOut)
    async handleNetworkOut({ data }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.egress)
    async handleEgress({ data }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.outboundNetwork)
    async handleOutboundNetwork({ data }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.bandwidth)
    async handleBandwidth({ data }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data } as Job<SchedulerEntity>);
    }

    @Process(infrastructureType.networkOutBytes)
    async handleNetworkOutBytes({ data }: Job<SchedulerEntity>) {
        return this.readOperationJob({ data } as Job<SchedulerEntity>);
    }

    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters as any;
        if (!dimensionId) {
            throw new BadRequestException('dimensionId not found in scheduleParameters');
        }
        NetworkOutDataGathererService.logger.log(
            'Processing NetworkOut gathering event, logging inputs',
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

        // Fetch EC2 instances in the specified region
        let instances: any[] = [];
        try {
            const ec2Client = new EC2Client({ region, credentials: creds });
            let next: string | undefined;
            do {
                const response = await ec2Client.send(
                    new DescribeInstancesCommand({
                        NextToken: next,
                        Filters: [{ Name: 'tag-key', Values: ['meteringcoDimensionId'] }],
                    }),
                );
                next = response?.NextToken;
                const { Reservations } = response;
                if (Reservations) {
                    Reservations.forEach((reservation) => {
                        const { Instances } = reservation;
                        if (Instances) {
                            instances = instances.concat(Instances);
                        }
                    });
                }
            } while (next);
        } catch (err) {
            NetworkOutDataGathererService.logger.error('Error fetching instances', err);
            if ((err as any).Code === 'AccessDenied') {
                throw new BadRequestException('Invalid IAM role or external ID');
            }
            throw new BadRequestException('Error fetching instances');
        }

        // Filter instances: must have meteringcoCustomerId and meteringcoDimensionId containing dimensionId
        const taggedInstances = instances.filter((instance) => {
            const tags: Array<{ Key: string; Value: string }> = instance.Tags || [];
            const dimTag = tags.find((t) => t.Key === 'meteringcoDimensionId');
            if (!dimTag) return false;
            const dims = dimTag.Value.split(',').map((s) => s.trim());
            if (!dims.includes(dimensionId)) return false;
            const custTag = tags.find((t) => t.Key === 'meteringcoCustomerId');
            if (!custTag || !custTag.Value) return false;
            return true;
        });

        if (taggedInstances.length === 0) {
            NetworkOutDataGathererService.logger.log('No tagged instances found for dimension', dimensionId);
            return;
        }

        // Build map instanceId -> customerId
        const instanceToCustomer = new Map<string, string>();
        taggedInstances.forEach((inst) => {
            const cust = inst.Tags.find((t) => t.Key === 'meteringcoCustomerId')?.Value;
            instanceToCustomer.set(inst.InstanceId, cust);
        });

        const instanceIds = Array.from(instanceToCustomer.keys());

        // Query CloudWatch for NetworkOut per instance
        const cwClient = new CloudWatchClient({ region, credentials: creds });

        // We query a window that captures the last completed 5-min period.
        // The emulator places points a few minutes before anchor, so a 10-min window ending now
        // reliably captures the single 5-min bucket that holds the interval's bytes.
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 10 * 60 * 1000);

        // Batch queries (GetMetricData limit 500 per call)
        const chunkSize = 500;
        const customerSums = new Map<string, number>();
        const customerHasData = new Map<string, boolean>();

        // Initialize maps
        instanceIds.forEach((id) => {
            const cust = instanceToCustomer.get(id)!;
            if (!customerSums.has(cust)) {
                customerSums.set(cust, 0);
                customerHasData.set(cust, false);
            }
        });

        // Helper to process chunk
        for (let i = 0; i < instanceIds.length; i += chunkSize) {
            const chunkIds = instanceIds.slice(i, i + chunkSize);
            const queries = chunkIds.map((id, idx) => ({
                Id: `m${i + idx + 1}`,
                MetricStat: {
                    Metric: {
                        Namespace: 'AWS/EC2',
                        MetricName: 'NetworkOut',
                        Dimensions: [{ Name: 'InstanceId', Value: id }],
                    },
                    Period: 300,
                    Stat: 'Sum',
                    Unit: 'Bytes' as const,
                },
            }));

            const idToInstance = new Map<string, string>();
            queries.forEach((q, idx) => {
                idToInstance.set(q.Id, chunkIds[idx]);
            });

            try {
                const result = await cwClient.send(
                    new GetMetricDataCommand({
                        StartTime: startTime,
                        EndTime: endTime,
                        ScanBy: 'TimestampDescending',
                        MetricDataQueries: queries,
                    }),
                );

                const results = result.MetricDataResults || [];
                for (const res of results) {
                    const instId = idToInstance.get(res.Id!);
                    if (!instId) continue;
                    const cust = instanceToCustomer.get(instId);
                    if (!cust) continue;
                    const values = res.Values || [];
                    if (values.length > 0) {
                        const sum = values.reduce((a, b) => a + b, 0);
                        customerSums.set(cust, (customerSums.get(cust) || 0) + sum);
                        customerHasData.set(cust, true);
                    } else {
                        // No datapoint for this instance in window -> no contribution, do not mark hasData
                        // If all instances for a customer have no datapoint, that customer will be skipped
                    }
                }
            } catch (err) {
                NetworkOutDataGathererService.logger.error('Error fetching CloudWatch metrics', err);
                // Continue with other chunks; if critical, rethrow?
                AuditService.publishEvent({
                    message: 'Failed to fetch NetworkOut metrics',
                    data: [{ error: (err as any).message, stack: (err as any).stack }],
                    topic: AuditScope.ERROR,
                });
                // Try fallback to GetMetricStatistics per instance if GetMetricData fails?
                // For now, continue
            }
        }

        // Publish per customer where at least one instance had data
        for (const [customerId, total] of customerSums.entries()) {
            if (!customerHasData.get(customerId)) {
                NetworkOutDataGathererService.logger.log(`Skipping customer ${customerId} - no datapoints for any instance`);
                continue;
            }
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata: { region },
                recordValue: total,
                customerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
            NetworkOutDataGathererService.logger.log(`Published NetworkOut usage for customer ${customerId}: ${total} bytes`);
        }

        NetworkOutDataGathererService.logger.log('Finished collecting NetworkOut data');
    }

    @OnQueueFailed({ name: infrastructureType.networkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut',
            data: [job.data],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.egress })
    jobFailureEgress(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut (egress)',
            data: [job.data],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.outboundNetwork })
    jobFailureOutbound(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut (outboundNetwork)',
            data: [job.data],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.bandwidth })
    jobFailureBandwidth(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut (bandwidth)',
            data: [job.data],
            topic: AuditScope.ERROR,
        });
    }

    @OnQueueFailed({ name: infrastructureType.networkOutBytes })
    jobFailureBytes(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut (networkOutBytes)',
            data: [job.data],
            topic: AuditScope.ERROR,
        });
    }
}
