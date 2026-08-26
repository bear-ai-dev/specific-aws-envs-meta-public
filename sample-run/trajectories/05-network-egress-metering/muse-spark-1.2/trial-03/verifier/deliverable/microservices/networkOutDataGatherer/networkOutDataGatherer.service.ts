import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { EC2Client, DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import { CloudWatchClient, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
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
    async handleNetworkOut(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    @Process('instanceNetworkOut')
    async handleInstanceNetworkOut(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    @Process('networkEgress')
    async handleNetworkEgress(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    @Process('instanceNetworkEgress')
    async handleInstanceNetworkEgress(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    // Also handle possible legacy names
    @Process('networkOutBytes')
    async handleNetworkOutBytes(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    @Process('egressBytes')
    async handleEgressBytes(job: Job<SchedulerEntity>) {
        return this.readOperationJob(job);
    }

    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        NetworkOutDataGathererService.logger.log(
            'Processing NetworkOut gathering event, logging inputs',
            JSON.stringify({ rate, businessID, externalId, subject, region, dimensionId }),
        );
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        const endpoint = process.env.AWS_ENDPOINT_URL;
        const ec2Client = new EC2Client({ region, credentials: creds, endpoint } as any);

        let instances: any[] = [];
        let nextToken: string | undefined = undefined;
        const filters = [{ Name: 'tag-key', Values: ['meteringcoDimensionId'] }];
        do {
            const resp: any = await ec2Client.send(
                new DescribeInstancesCommand({ Filters: filters, NextToken: nextToken, MaxResults: 100 } as any),
            );
            const reservations = resp.Reservations || [];
            for (const reservation of reservations) {
                const reservationInstances = reservation.Instances || [];
                instances = instances.concat(reservationInstances);
            }
            nextToken = resp.NextToken;
        } while (nextToken);

        const taggedInstances = instances.filter((instance) => {
            const tags = instance.Tags || [];
            const dimTag = tags.find((t: any) => t.Key === 'meteringcoDimensionId');
            if (!dimTag || !dimTag.Value) return false;
            const dimIds = dimTag.Value.split(',').map((s: string) => s.trim());
            if (!dimIds.includes(dimensionId)) return false;
            const custTag = tags.find((t: any) => t.Key === 'meteringcoCustomerId');
            if (!custTag || !custTag.Value) return false;
            return true;
        });

        if (taggedInstances.length === 0) {
            NetworkOutDataGathererService.logger.log('No instances matched dimension filter');
            return;
        }

        const cwClient = new CloudWatchClient({ region, credentials: creds, endpoint } as any);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - 15 * 60 * 1000);
        const customerGroups: Record<string, { total: number; hasData: boolean; sampleInstance: any }> = {};
        for (const instance of taggedInstances) {
            const instanceId = instance.InstanceId;
            const tags = instance.Tags || [];
            const custId = tags.find((t: any) => t.Key === 'meteringcoCustomerId')?.Value;
            if (!custId) continue;
            if (!customerGroups[custId]) {
                customerGroups[custId] = { total: 0, hasData: false, sampleInstance: instance };
            }
            try {
                const cwResp = await cwClient.send(
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
                const datapoints = (cwResp as any).Datapoints || [];
                if (datapoints.length > 0) {
                    customerGroups[custId].hasData = true;
                    const sum = datapoints.reduce((acc: number, dp: any) => acc + (dp.Sum || 0), 0);
                    customerGroups[custId].total += sum;
                }
            } catch (e: any) {
                NetworkOutDataGathererService.logger.error(`Failed to get NetworkOut for ${instanceId}`, e);
                AuditService.publishEvent({
                    message: `Failed to get NetworkOut for instance ${instanceId}`,
                    data: [e],
                    topic: AuditScope.ERROR,
                });
            }
        }
        for (const custId of Object.keys(customerGroups)) {
            const group = customerGroups[custId];
            if (!group.hasData) {
                NetworkOutDataGathererService.logger.log(`Skipping customer ${custId} with no datapoints`);
                continue;
            }
            const sample = group.sampleInstance;
            const metadata: Record<string, string> = {};
            const tags = sample.Tags || [];
            for (const t of tags) {
                metadata[t.Key] = t.Value;
            }
            metadata['InstanceId'] = sample.InstanceId;
            metadata['region'] = region;
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata,
                recordValue: group.total,
                customerId: custId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        }
        NetworkOutDataGathererService.logger.log('Finished collecting NetworkOut data', { customerCount: Object.keys(customerGroups).length });
    }

    @OnQueueFailed({ name: infrastructureType.networkOut })
    @OnQueueFailed({ name: 'instanceNetworkOut' })
    @OnQueueFailed({ name: 'networkEgress' })
    @OnQueueFailed({ name: 'instanceNetworkEgress' })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure NetworkOut',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
