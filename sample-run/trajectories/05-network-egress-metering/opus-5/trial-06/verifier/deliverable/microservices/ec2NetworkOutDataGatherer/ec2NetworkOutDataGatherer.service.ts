import { BadRequestException, Logger } from '@nestjs/common';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';

import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { infrastructureType } from '../../dimensions/dto/create-dimension.dto.js';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity.js';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { SupportedMeasurementFrequencies } from '../../scheduler/dto/scheduler.dto.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import {
    DEFAULT_METRIC_PERIOD_IN_SECONDS,
    NETWORK_OUT_METRIC_NAME,
    getInstanceNetworkOutBytes,
} from '../../utils/aws/awsCloudwatch.js';

/**
 * @author MeteringCo
 *
 * Turns the outbound network traffic (egress) of a customers EC2 instances into billable usage.
 *
 * Instances opt into being metered with two tags:
 *  - `meteringcoDimensionId`, a comma separated list of the dimensions the instance is metered on
 *  - `meteringcoCustomerId`, the customer the instance belongs to
 *
 * An instance without a customer, or which is not tagged with the dimension the run is for, is not
 * part of the run. Every other instance has the bytes it sent out over the interval read from
 * CloudWatch (`AWS/EC2` `NetworkOut`) and added to the total of the customer it belongs to,
 * regardless of the power state of the instance: a stopped or terminated instance still sent
 * whatever it sent while it was running.
 *
 * One record per customer, in bytes, is published against the dimension of the run.
 */
@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);
    public static readonly dimensionIdTag = 'meteringcoDimensionId';
    public static readonly customerIdTag = 'meteringcoCustomerId';
    /**
     * Observations for a five minute interval land in CloudWatch a few minutes after the fact, so the
     * window read for a run reaches back further than the interval of the run itself.
     */
    public static readonly minimumLookbackInMS = 600000;

    constructor() {}

    @Process(infrastructureType.ec2NetworkOut)
    async readOperationJob({ data }: Job<SchedulerEntity>) {
        const { scheduleParameters, subject } = data;
        if (!scheduleParameters || !('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId } = scheduleParameters;
        // The business, the rate and the region travel on the run itself, older schedules carry them
        // on the schedule parameters instead.
        const businessID = data?.businessID ? data.businessID : scheduleParameters['businessID'];
        const rate = data?.rate ? data.rate : scheduleParameters['rate'];
        const region = scheduleParameters['region'] ? scheduleParameters['region'] : process.env.AWS_REGION;
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
            clientConfig: { region: region ? region : 'us-east-1' },
        });

        // Power state is irrelevant, a machine which has since been stopped or torn down still sent
        // whatever it sent while it was up, so no instance state filter is applied here.
        const instanceList = await getInstanceWithFilters(region, creds, [
            { Name: 'tag-key', Values: [Ec2NetworkOutDataGathererService.dimensionIdTag] },
        ]);
        const meteredInstances = Ec2NetworkOutDataGathererService.filterInstancesForDimension(
            instanceList,
            dimensionId,
        );
        Ec2NetworkOutDataGathererService.logger.log(
            `Found ${meteredInstances.length} instance(s) metered on dimension ${dimensionId}`,
        );
        if (meteredInstances.length === 0) {
            Ec2NetworkOutDataGathererService.logger.log('No metered instances found, nothing to record');
            return;
        }

        const { startTime, endTime, periodInSeconds } = Ec2NetworkOutDataGathererService.getMeasurementWindow(rate);
        const networkOutByInstance = await getInstanceNetworkOutBytes({
            region,
            credentials: creds,
            instanceIds: meteredInstances.map(({ InstanceId }) => InstanceId),
            startTime,
            endTime,
            periodInSeconds,
        });

        // Several instances of the same customer add into a single figure for the customer
        const usageByCustomer = meteredInstances.reduce(
            (accumulator, instance) => {
                const customerId = Ec2NetworkOutDataGathererService.getTagValue(
                    instance,
                    Ec2NetworkOutDataGathererService.customerIdTag,
                );
                const observation = networkOutByInstance[instance.InstanceId];
                const current = accumulator[customerId]
                    ? accumulator[customerId]
                    : { bytes: 0, datapointCount: 0, instanceIds: [] };
                current.instanceIds.push(instance.InstanceId);
                if (observation) {
                    current.bytes += observation.total;
                    current.datapointCount += observation.datapointCount;
                }
                accumulator[customerId] = current;
                return accumulator;
            },
            {} as Record<string, { bytes: number; datapointCount: number; instanceIds: string[] }>,
        );

        Object.keys(usageByCustomer).forEach((customerId) => {
            const { bytes, datapointCount, instanceIds } = usageByCustomer[customerId];
            if (datapointCount === 0) {
                // CloudWatch held no observation at all for this customers instances over the window.
                // Nothing was measured, which is not the same thing as measuring a zero.
                Ec2NetworkOutDataGathererService.logger.log(
                    `No ${NETWORK_OUT_METRIC_NAME} observations for customer ${customerId} on dimension ${dimensionId}`,
                );
                return;
            }
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                customerId,
                // Raw bytes, neither rounded nor converted into a larger unit
                recordValue: bytes,
                metadata: {
                    region,
                    metricName: NETWORK_OUT_METRIC_NAME,
                    meteringcoCustomerId: customerId,
                    meteringcoDimensionId: dimensionId,
                    instanceIds: instanceIds.join(','),
                    instanceCount: instanceIds.length,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                },
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });
        Ec2NetworkOutDataGathererService.logger.log('Finished collecting EC2 instance network out data');
    }

    /**
     * Keeps the instances which are metered on the dimension the run is for and belong to a customer.
     */
    public static filterInstancesForDimension(instanceList: Array<any>, dimensionId: string): Array<any> {
        if (!instanceList) {
            return [];
        }
        return instanceList.filter((instance) => {
            const dimensionIds = Ec2NetworkOutDataGathererService.getTagValue(
                instance,
                Ec2NetworkOutDataGathererService.dimensionIdTag,
            );
            const customerId = Ec2NetworkOutDataGathererService.getTagValue(
                instance,
                Ec2NetworkOutDataGathererService.customerIdTag,
            );
            if (!customerId || !dimensionIds) {
                return false;
            }
            return dimensionIds
                .split(',')
                .map((taggedDimensionId) => taggedDimensionId.trim())
                .includes(dimensionId);
        });
    }

    private static getTagValue(instance: any, key: string): string | undefined {
        const tag = instance?.Tags?.find(({ Key }) => Key === key);
        const value = tag?.Value ? tag.Value.trim() : undefined;
        return value ? value : undefined;
    }

    /**
     * The window of time a run accounts for.
     *
     * CloudWatch publishes EC2 network metrics against five minute boundaries and only makes them
     * readable a few minutes later, so the window reaches back over the interval of the run plus the
     * lag of the observations. Datapoints are summed, so an interval spanning several periods is
     * still billed for every byte it holds and no byte is billed twice.
     */
    public static getMeasurementWindow(rate?: SupportedMeasurementFrequencies | string): {
        startTime: Date;
        endTime: Date;
        periodInSeconds: number;
    } {
        const intervalInMS = Ec2NetworkOutDataGathererService.rateToIntervalInMS(rate);
        const lookbackInMS = Math.max(intervalInMS * 2, Ec2NetworkOutDataGathererService.minimumLookbackInMS);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - lookbackInMS);
        return { startTime, endTime, periodInSeconds: DEFAULT_METRIC_PERIOD_IN_SECONDS };
    }

    private static rateToIntervalInMS(rate?: SupportedMeasurementFrequencies | string): number {
        const fiveMinutesInMS = 300000;
        switch (rate) {
            case SupportedMeasurementFrequencies.perMinute:
                return 60000;
            case SupportedMeasurementFrequencies.everyFiveMinutes:
                return fiveMinutesInMS;
            case SupportedMeasurementFrequencies.everyThirtyMinutes:
                return 1800000;
            case SupportedMeasurementFrequencies.everyHour:
                return 3600000;
            default:
                return fiveMinutesInMS;
        }
    }

    @OnQueueFailed({ name: infrastructureType.ec2NetworkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 instance network out',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
