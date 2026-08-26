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
import { getNetworkOutBytesByInstance, NETWORK_OUT_METRIC_NAME } from '../../utils/aws/awsCloudWatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';

/**
 * The tag an instance carries to list, comma separated, every dimension it is metered on.
 */
const DIMENSION_TAG_KEY = 'meteringcoDimensionId';

/**
 * The tag an instance carries to name the customer the instance belongs to.
 */
const CUSTOMER_TAG_KEY = 'meteringcoCustomerId';

/**
 * EC2 publishes NetworkOut on a five minute grain, which is the grain this collection runs on.
 */
const METRIC_PERIOD_IN_SECONDS = 300;

/**
 * How far back a run looks for observations. AWS publishes an instance metric a few minutes after
 * the period it covers has finished, so a run which only looked at the five minutes it was
 * dispatched for would read a window CloudWatch has not filled in yet. Two periods covers the
 * interval which has just finished together with the publication delay in front of it.
 */
const LOOK_BACK_PERIODS = 2;

/**
 * @author MeteringCo
 *
 * Turns outbound network traffic of the EC2 instances inside a customer's own AWS account into
 * billable usage.
 *
 * Instances opt in through tags: `meteringcoDimensionId` lists every dimension the instance is metered
 * on (comma separated, so one instance can be metered on several) and `meteringcoCustomerId` names the
 * customer it belongs to. An instance without a customer, or whose dimension list does not hold
 * the dimension the run is for, takes no part in the run.
 *
 * The bytes each participating instance sent out over the interval are read from the CloudWatch
 * `AWS/EC2` `NetworkOut` metric (bytes leaving the instance, as opposed to `NetworkIn`) and totaled
 * per customer, in bytes, unrounded and unconverted. Several instances of one customer on the same
 * dimension add into that customer's single figure. Power state is irrelevant, an instance which
 * has since been stopped or terminated still sent whatever it sent while it was up, so no state
 * filter is applied.
 */
@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);
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
            JSON.stringify({
                rate,
                businessID,
                dimensionId,
                region,
                iamRoleArn,
                externalId,
                subject,
            }),
        );
        if (!dimensionId) {
            throw new BadRequestException('dimensionId not found');
        }

        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        // Every instance which opted into metering, in whatever power state. A stopped or
        // terminated instance still owes for the bytes it pushed out while it was running.
        const instanceList = await getInstanceWithFilters(region, creds, [
            { Name: 'tag-key', Values: [DIMENSION_TAG_KEY] },
        ]);

        const meteredInstances = (instanceList || []).filter((instance) =>
            Ec2NetworkOutDataGathererService.isMeteredOnDimension(instance, dimensionId),
        );
        Ec2NetworkOutDataGathererService.logger.log(
            `Found ${meteredInstances.length} instance(s) metered on dimension ${dimensionId}`,
        );
        if (meteredInstances.length === 0) {
            Ec2NetworkOutDataGathererService.logger.log('No instances are metered on this dimension, nothing to do');
            return;
        }

        const { startTime, endTime } = Ec2NetworkOutDataGathererService.gatheringWindow();
        const networkOutBytesByInstance = await getNetworkOutBytesByInstance({
            region,
            creds,
            instanceIds: meteredInstances.map(({ InstanceId }) => InstanceId),
            startTime,
            endTime,
            period: METRIC_PERIOD_IN_SECONDS,
        });

        // One figure per customer, the bytes every instance of theirs sent out added together.
        const bytesByCustomer: Record<string, { bytes: number; instanceIds: Array<string> }> = {};
        meteredInstances.forEach((instance) => {
            const customerId = Ec2NetworkOutDataGathererService.tagValue(instance, CUSTOMER_TAG_KEY);
            const networkOutBytes = networkOutBytesByInstance[instance.InstanceId];
            if (networkOutBytes === undefined) {
                // The instance published no observation over the interval, there is nothing to
                // bill for it. An instance which published zeroes is billed for those zeroes.
                Ec2NetworkOutDataGathererService.logger.log(
                    `No NetworkOut observation for instance ${instance.InstanceId} over the interval`,
                );
                return;
            }
            if (!bytesByCustomer[customerId]) {
                bytesByCustomer[customerId] = { bytes: 0, instanceIds: [] };
            }
            bytesByCustomer[customerId].bytes += networkOutBytes;
            bytesByCustomer[customerId].instanceIds.push(instance.InstanceId);
        });

        Object.keys(bytesByCustomer).forEach((customerId) => {
            const { bytes, instanceIds } = bytesByCustomer[customerId];
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                customerId,
                // Bytes as measured, neither rounded nor converted into a larger unit.
                recordValue: bytes,
                metadata: {
                    metricName: NETWORK_OUT_METRIC_NAME,
                    unit: 'byte',
                    region,
                    instanceIds: instanceIds.sort().join(','),
                    instanceCount: instanceIds.length,
                    intervalStart: startTime.toISOString(),
                    intervalEnd: endTime.toISOString(),
                },
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });

        Ec2NetworkOutDataGathererService.logger.log(
            `Finished collecting EC2 network out data, billed ${
                Object.keys(bytesByCustomer).length
            } customer(s) on dimension ${dimensionId}`,
        );
    }

    /**
     * The window a run reads observations for.
     */
    private static gatheringWindow(): { startTime: Date; endTime: Date } {
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - LOOK_BACK_PERIODS * METRIC_PERIOD_IN_SECONDS * 1000);
        return { startTime, endTime };
    }

    /**
     * An instance takes part in a run when it names a customer and lists the dimension the run is
     * for among the, comma separated, dimensions it is metered on.
     */
    private static isMeteredOnDimension(instance: { Tags?: Array<{ Key?: string; Value?: string }> }, dimensionId) {
        const customerId = Ec2NetworkOutDataGathererService.tagValue(instance, CUSTOMER_TAG_KEY);
        if (!customerId) {
            return false;
        }
        const meteredDimensions = (Ec2NetworkOutDataGathererService.tagValue(instance, DIMENSION_TAG_KEY) || '')
            .split(',')
            .map((value) => value.trim())
            .filter((value) => !!value);
        return meteredDimensions.includes(dimensionId);
    }

    private static tagValue(
        instance: { Tags?: Array<{ Key?: string; Value?: string }> },
        tagKey: string,
    ): string | undefined {
        const tag = (instance?.Tags || []).find(({ Key }) => Key === tagKey);
        return tag?.Value ? tag.Value.trim() : undefined;
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
