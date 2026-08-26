import { BadRequestException, Logger } from '@nestjs/common';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { ArrayGroupBy } from '../../utils/shared/utils.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

@Processor('scheduler_queue')
export class NetworkOutDataGathererService {
    private static readonly logger = new Logger(NetworkOutDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.networkOut)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        return this.handle({ scheduleParameters, businessID, subject, rate });
    }

    @Process(infrastructureType.ec2NetworkOut)
    async readOperationJobEc2({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        return this.handle({ scheduleParameters, businessID, subject, rate });
    }

    // fallback for any string containing network/egress - bull will dispatch by exact name, so we also handle generic names via separate methods
    // To support dynamic names, we also listen to a wildcard by processing the same queue with no filter? But we keep two primary.

    private async handle({ scheduleParameters, businessID, subject, rate }: { scheduleParameters: any; businessID: string; subject: string; rate: string }) {
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
                dimensionId,
                region,
            }),
        );

        const endpoint = process.env.AWS_ENDPOINT_URL;
        // Assume role via STS
        const stsClient = new STSClient({
            region: 'us-east-1',
            endpoint,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        });
        let assumedCreds: any;
        try {
            const assumed = await stsClient.send(
                new AssumeRoleCommand({
                    RoleArn: iamRoleArn,
                    RoleSessionName: 'network-out-session',
                    ExternalId: externalId ? externalId : undefined,
                }),
            );
            assumedCreds = {
                accessKeyId: assumed.Credentials!.AccessKeyId!,
                secretAccessKey: assumed.Credentials!.SecretAccessKey!,
                sessionToken: assumed.Credentials!.SessionToken!,
            };
        } catch (e) {
            NetworkOutDataGathererService.logger.error('Failed to assume role', e);
            throw e;
        }

        // EC2 client
        const ec2Client = new EC2Client({
            region,
            endpoint,
            credentials: assumedCreds,
        });

        // Get instances - include all states, no instance-state-name filter
        let instances: any[] = [];
        let nextToken: string | undefined = undefined;
        do {
            const command = new DescribeInstancesCommand({
                NextToken: nextToken,
                Filters: [{ Name: 'tag-key', Values: ['meteringcoDimensionId'] }],
            });
            const response = await ec2Client.send(command);
            nextToken = response?.NextToken;
            const reservations = response?.Reservations ?? [];
            for (const reservation of reservations) {
                const reservationInstances = reservation.Instances ?? [];
                instances = instances.concat(reservationInstances);
            }
        } while (nextToken);

        NetworkOutDataGathererService.logger.log(`Found ${instances.length} instances with meteringcoDimensionId tag`);

        const taggedInstance = instances.filter((instance) => {
            const tags = instance.Tags ?? [];
            const taggedDimensionIdVal = tags.find((tag: any) => tag.Key === 'meteringcoDimensionId');
            if (!taggedDimensionIdVal) {
                return false;
            }
            const meteringcoDimensionIds = taggedDimensionIdVal.Value.split(',').map((s: string) => s.trim());
            const hasDimension = meteringcoDimensionIds.includes(dimensionId);
            const hasCustomer = !!tags.find((tag: any) => tag.Key === 'meteringcoCustomerId');
            return hasDimension && hasCustomer;
        });

        if (taggedInstance.length === 0) {
            NetworkOutDataGathererService.logger.log('No instances matched dimension and customer filter');
            return;
        }

        // Attach tags as properties for grouping
        taggedInstance.forEach((instance) => {
            const tags = instance.Tags ?? [];
            tags.forEach((tag: any) => {
                (instance as any)[tag.Key] = tag.Value;
            });
        });

        const instanceGroupByCustomer = ArrayGroupBy(['meteringcoCustomerId']);
        const groupedInstances = instanceGroupByCustomer(taggedInstance);

        // For CloudWatch, query each instance for NetworkOut sum over last 5-10 minutes
        const cloudWatchClient = new CloudWatchClient({
            region,
            endpoint,
            credentials: assumedCreds,
        });

        const now = new Date();
        // Use 10 minute window to capture few-minutes-old observations (aligned outward)
        const startTime = new Date(now.getTime() - 600 * 1000);
        const endTime = new Date(now.getTime());

        // For each customer, sum NetworkOut across its instances
        for (const customerId of Object.keys(groupedInstances)) {
            const instancesForCustomer: any[] = groupedInstances[customerId];
            let totalBytes = 0;
            let hasDataForCustomer = false;

            // Query each instance in parallel
            const perInstanceResults = await Promise.all(
                instancesForCustomer.map(async (instance: any) => {
                    const instanceId = instance.InstanceId;
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
                        const out = await cloudWatchClient.send(cmd);
                        const datapoints = out.Datapoints ?? [];
                        if (datapoints.length === 0) {
                            return { sum: 0, hasData: false };
                        }
                        // Sum all datapoints' Sum
                        const sum = datapoints.reduce((acc: number, dp: any) => acc + (dp.Sum ?? 0), 0);
                        return { sum, hasData: true };
                    } catch (e) {
                        NetworkOutDataGathererService.logger.error(`Failed to get metric for ${instanceId}`, e);
                        return { sum: 0, hasData: false };
                    }
                }),
            );

            for (const r of perInstanceResults) {
                if (r.hasData) hasDataForCustomer = true;
                totalBytes += r.sum;
            }

            // If no instance had data, skip publishing for this customer (absent vs zero)
            // But if at least one had data (even zero sum), we publish
            if (!hasDataForCustomer) {
                NetworkOutDataGathererService.logger.log(`No CloudWatch data for customer ${customerId}, skipping`);
                continue;
            }

            // Publish one measurement per customer
            const firstInstance = instancesForCustomer[0];
            const metadata: Record<string, string> = {};
            // Include some metadata from first instance for debugging, but not required
            // We keep metadata minimal
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: totalBytes,
                customerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
            NetworkOutDataGathererService.logger.log(`Published NetworkOut ${totalBytes} bytes for customer ${customerId} on dimension ${dimensionId}`);
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

    @OnQueueFailed({ name: infrastructureType.ec2NetworkOut })
    jobFailureEc2(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut (ec2NetworkOut)',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
