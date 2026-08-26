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
import { getInstanceMetricTotals } from '../../utils/aws/awsCloudwatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { Ec2NetworkOutDataGathererDto } from './dto/ec2NetworkOutDataGatherer.dto.js';

/**
 * An instance which opted into metering, with the tags which decide whether it is part of a run.
 */
interface MeteredInstance {
    instanceId: string;
    customerId: string;
    dimensionIds: Array<string>;
}

/**
 * The bytes one customer sent out over the interval, and the instances which sent them.
 */
interface CustomerNetworkOut {
    bytes: number;
    instanceIds: Array<string>;
}

/**
 * Meters the outbound network traffic of the EC2 instances inside a customers AWS account.
 *
 * Instances opt into metering with the `meteringcoDimensionId` tag, which holds a comma separated list
 * of the dimensions the instance is metered on, and the `meteringcoCustomerId` tag which names the
 * customer the instance belongs to. The bytes each instance sent out during the interval are read
 * from the `AWS/EC2` `NetworkOut` CloudWatch metric and summed per customer, in bytes.
 *
 * The power state of an instance is irrelevant, an instance which has since been stopped or
 * terminated still sent whatever it sent while it was running and its customer owes for it.
 */
@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);

    /**
     * The CloudWatch metric holding the bytes an instance sent out. `NetworkIn` is the traffic
     * arriving at the instance and is deliberately not what is billed here.
     */
    public static readonly metricName = 'NetworkOut';

    /**
     * The dimension tag holding the comma separated list of dimensions an instance is metered on.
     */
    public static readonly dimensionTagKey = 'meteringcoDimensionId';

    /**
     * The tag naming the customer an instance belongs to.
     */
    public static readonly customerTagKey = 'meteringcoCustomerId';

    /**
     * The length of the interval a run meters, matching the rate the collection is scheduled at.
     */
    public static readonly periodInSeconds = 300;

    /**
     * EC2 publishes its network metrics a few minutes behind the wall clock, so a run reads the
     * interval which closed before the one it fires in. Every interval is therefore read by exactly
     * one run: nothing is billed twice and nothing is missed.
     */
    public static readonly observationDelayInPeriods = 1;

    constructor() {}

    /**
     * The window a run meters: one whole period, aligned to period boundaries so consecutive runs
     * read consecutive intervals, held back far enough for the observations to have been published.
     */
    public static measurementWindow(now: Date = new Date()): { startTime: Date; endTime: Date } {
        const periodInMs = Ec2NetworkOutDataGathererService.periodInSeconds * 1000;
        const currentBoundary = Math.floor(now.getTime() / periodInMs) * periodInMs;
        const endTime = new Date(
            currentBoundary - Ec2NetworkOutDataGathererService.observationDelayInPeriods * periodInMs,
        );
        const startTime = new Date(endTime.getTime() - periodInMs);
        return { startTime, endTime };
    }

    @Process(infrastructureType.ec2NetworkOut)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters as Ec2NetworkOutDataGathererDto;
        Ec2NetworkOutDataGathererService.logger.log(
            'Processing Automated EC2 network out gathering event, logging inputs',
            JSON.stringify({ rate, businessID, dimensionId, externalId, region, subject }),
        );

        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        // Every instance carrying the dimension tag is a candidate, no matter which state it is in,
        // a stopped or terminated instance still sent traffic while it was up.
        const instanceList = await getInstanceWithFilters(region, creds, [
            { Name: 'tag-key', Values: [Ec2NetworkOutDataGathererService.dimensionTagKey] },
        ]);

        const meteredInstances: Array<MeteredInstance> = instanceList
            .map((instance) => {
                const tags = StandardMeasurementEntity.awsTagKeyReducer(instance?.Tags);
                return {
                    instanceId: instance?.InstanceId,
                    customerId: tags[Ec2NetworkOutDataGathererService.customerTagKey],
                    dimensionIds: (tags[Ec2NetworkOutDataGathererService.dimensionTagKey] ?? '')
                        .split(',')
                        .map((taggedDimensionId: string) => taggedDimensionId.trim())
                        .filter((taggedDimensionId: string) => taggedDimensionId.length),
                };
            })
            .filter(
                ({ instanceId, customerId, dimensionIds }) =>
                    !!instanceId && !!customerId && dimensionIds.includes(dimensionId),
            );

        Ec2NetworkOutDataGathererService.logger.log(
            `Found ${meteredInstances.length} instance(s) metered on dimension ${dimensionId}`,
        );
        if (!meteredInstances.length) {
            Ec2NetworkOutDataGathererService.logger.log('No EC2 instances are metered for outbound network traffic');
            return;
        }

        const { startTime, endTime } = Ec2NetworkOutDataGathererService.measurementWindow();
        const networkOutByInstance = await getInstanceMetricTotals({
            region,
            credentials: creds,
            metricName: Ec2NetworkOutDataGathererService.metricName,
            instanceIds: meteredInstances.map(({ instanceId }) => instanceId),
            startTime,
            endTime,
            periodInSeconds: Ec2NetworkOutDataGathererService.periodInSeconds,
        });

        // Several instances of one customer can be metered on the same dimension, what each of them
        // sent adds into the single figure billed to that customer for the run.
        const bytesByCustomer = meteredInstances.reduce<Record<string, CustomerNetworkOut>>(
            (acc, { instanceId, customerId }) => {
                const reading = networkOutByInstance[instanceId];
                if (!reading?.observed) {
                    // CloudWatch held no observation for the instance over the interval, there is
                    // nothing to bill it for.
                    return acc;
                }
                const usage = acc[customerId] ?? { bytes: 0, instanceIds: [] };
                usage.bytes += reading.total;
                usage.instanceIds.push(instanceId);
                acc[customerId] = usage;
                return acc;
            },
            {},
        );

        Object.entries(bytesByCustomer).forEach(([customerId, { bytes, instanceIds }]) => {
            Ec2NetworkOutDataGathererService.logger.log(
                `Customer ${customerId} sent ${bytes} bytes out from instance(s) ${instanceIds.join(', ')}`,
            );
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                customerId,
                // The bytes the customers instances sent, neither rounded nor converted.
                recordValue: bytes,
                metadata: {
                    region,
                    metricName: Ec2NetworkOutDataGathererService.metricName,
                },
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });

        Ec2NetworkOutDataGathererService.logger.log(
            `Finished collecting EC2 network out data for ${Object.keys(bytesByCustomer).length} customer(s)`,
        );
    }

    @OnQueueFailed({ name: infrastructureType.ec2NetworkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 outbound network traffic',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
