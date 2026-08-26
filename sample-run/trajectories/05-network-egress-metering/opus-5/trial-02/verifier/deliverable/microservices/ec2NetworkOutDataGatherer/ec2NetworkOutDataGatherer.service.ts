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
import { EC2_METRIC_NAMESPACE, NETWORK_OUT_METRIC_NAME, getInstanceMetricSums } from '../../utils/aws/awsCloudWatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';

/**
 * @author MeteringCo
 *
 * Turns the outbound network traffic of the EC2 instances inside a customer's account into
 * billable usage.
 *
 * Every instance carrying the `meteringcoDimensionId` tag with the dimension of the run in its
 * (comma separated) list, and a `meteringcoCustomerId` tag naming the customer it belongs to, is
 * measured. The bytes the instance sent out over the interval (the `NetworkOut` metric of the
 * `AWS/EC2` namespace, which counts bytes leaving the instance, as opposed to `NetworkIn`) are
 * added up per customer and recorded as one usage record per customer against the dimension
 * of the run, in bytes.
 *
 * The power state of an instance is irrelevant: an instance which has since been stopped or
 * terminated still sent whatever it sent while it was running, and its customer owes for it.
 */
@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);

    /**
     * Tag listing the dimensions an instance is metered on, comma separated
     */
    public static readonly dimensionTagKey = 'meteringcoDimensionId';

    /**
     * Tag naming the customer an instance belongs to
     */
    public static readonly customerTagKey = 'meteringcoCustomerId';

    /**
     * The granularity the metric is read at, matching the five minute schedule of the collection
     */
    public static readonly metricPeriodInSeconds = 300;

    /**
     * CloudWatch publishes instance metrics with a few minutes of delay, so the window read
     * reaches back further than a single interval to make sure the traffic of the interval which
     * just finished is picked up rather than missed.
     */
    public static readonly lookBackWindowInSeconds = 900;

    constructor() {}

    @Process(infrastructureType.instanceNetworkOut)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        Ec2NetworkOutDataGathererService.logger.log(
            'Processing Automated EC2 network out gathering event, logging inputs',
            JSON.stringify({ rate, businessID, externalId, subject, dimensionId, region }),
        );
        if (!dimensionId) {
            throw new BadRequestException('dimensionId not found in schedule parameters');
        }
        const targetRegion = region ? region : process.env.AWS_REGION;
        if (!targetRegion) {
            throw new BadRequestException('region not found in schedule parameters');
        }
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        // Every instance which opted into metering, whatever its power state
        const instanceList = await getInstanceWithFilters(targetRegion, creds, [
            { Name: 'tag-key', Values: [Ec2NetworkOutDataGathererService.dimensionTagKey] },
        ]);

        const meteredInstances = (instanceList ? instanceList : []).filter((instance) =>
            Ec2NetworkOutDataGathererService.isInstanceMeteredOnDimension(instance, dimensionId),
        );
        Ec2NetworkOutDataGathererService.logger.log(
            `Found ${meteredInstances.length} instance(s) metered on dimension ${dimensionId} in ${targetRegion}`,
        );
        if (!meteredInstances.length) {
            Ec2NetworkOutDataGathererService.logger.log('No instances metered on this dimension, nothing to record');
            return { message: 'No metered instances found', data: [] };
        }

        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - Ec2NetworkOutDataGathererService.lookBackWindowInSeconds * 1000);
        const observations = await getInstanceMetricSums({
            region: targetRegion,
            creds,
            instanceIds: meteredInstances.map(({ InstanceId }) => InstanceId),
            namespace: EC2_METRIC_NAMESPACE,
            metricName: NETWORK_OUT_METRIC_NAME,
            startTime,
            endTime,
            period: Ec2NetworkOutDataGathererService.metricPeriodInSeconds,
        });

        // Several instances of the same customer add into that customer's single figure
        const bytesSentPerCustomer = meteredInstances.reduce(
            (accumulator, instance) => {
                const customerId = Ec2NetworkOutDataGathererService.getTagValue(
                    instance,
                    Ec2NetworkOutDataGathererService.customerTagKey,
                );
                const observation = observations[instance.InstanceId];
                if (!observation || !observation.datapointCount) {
                    // CloudWatch reported nothing for this instance over the interval, which is not
                    // the same thing as it having reported no traffic
                    Ec2NetworkOutDataGathererService.logger.debug(
                        `No ${NETWORK_OUT_METRIC_NAME} observations for ${instance.InstanceId} over the interval`,
                    );
                    return accumulator;
                }
                if (!accumulator[customerId]) {
                    accumulator[customerId] = { bytesSent: 0, instanceIds: [] };
                }
                accumulator[customerId].bytesSent += observation.total;
                accumulator[customerId].instanceIds.push(instance.InstanceId);
                return accumulator;
            },
            {} as Record<string, { bytesSent: number; instanceIds: Array<string> }>,
        );

        const published = Object.keys(bytesSentPerCustomer).map((customerId) => {
            const { bytesSent, instanceIds } = bytesSentPerCustomer[customerId];
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                customerId,
                // The bytes the customer's instances sent out, unrounded and unconverted
                recordValue: bytesSent,
                metadata: {
                    region: targetRegion,
                    metricName: NETWORK_OUT_METRIC_NAME,
                    instanceCount: instanceIds.length,
                },
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
            return entity;
        });

        Ec2NetworkOutDataGathererService.logger.log(
            `Finished collecting EC2 network out data, recorded usage for ${published.length} customer(s)`,
        );
        return { message: 'Recorded EC2 network out usage', data: published };
    }

    /**
     * An instance takes part in a run when it names the dimension of the run in its dimension
     * tag and names the customer it belongs to.
     */
    private static isInstanceMeteredOnDimension(instance, dimensionId: string): boolean {
        const dimensionTagValue = Ec2NetworkOutDataGathererService.getTagValue(
            instance,
            Ec2NetworkOutDataGathererService.dimensionTagKey,
        );
        const customerId = Ec2NetworkOutDataGathererService.getTagValue(
            instance,
            Ec2NetworkOutDataGathererService.customerTagKey,
        );
        if (!dimensionTagValue || !customerId) {
            return false;
        }
        return dimensionTagValue
            .split(',')
            .map((taggedDimensionId) => taggedDimensionId.trim())
            .includes(dimensionId);
    }

    private static getTagValue(instance, tagKey: string): string | undefined {
        const tags = instance?.Tags ? instance.Tags : [];
        const tag = tags.find(({ Key }) => Key === tagKey);
        return tag ? tag.Value : undefined;
    }

    @OnQueueFailed({ name: infrastructureType.instanceNetworkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 instance network out',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
