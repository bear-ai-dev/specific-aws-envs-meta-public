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
import {
    EC2_METRIC_NAMESPACE,
    NETWORK_OUT_METRIC_NAME,
    SUM_STATISTIC,
    getInstanceMetricTotals,
} from '../../utils/aws/awsCloudwatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';

/**
 * The tag an instance carries to declare which dimensions it is metered on.
 * The value is a comma separated list, so one instance can be metered on several dimensions.
 */
export const DIMENSION_TAG_KEY = 'meteringcoDimensionId';

/**
 * The tag an instance carries to declare which customer it belongs to.
 */
export const CUSTOMER_TAG_KEY = 'meteringcoCustomerId';

/**
 * The metered interval, the collection is scheduled every five minutes.
 */
export const NETWORK_OUT_INTERVAL_IN_MS = 5 * 60 * 1000;

/**
 * CloudWatch publishes EC2 instance metrics with a delay, so the window read back is
 * widened beyond the interval itself. Without it a run would look at a window which
 * CloudWatch has not filled in yet and bill nothing at all.
 */
export const NETWORK_OUT_LOOKBACK_IN_MS = 3 * NETWORK_OUT_INTERVAL_IN_MS;

/**
 * The resolution requested from CloudWatch, matching the interval of the collection.
 */
export const NETWORK_OUT_PERIOD_IN_SECONDS = NETWORK_OUT_INTERVAL_IN_MS / 1000;

export interface NetworkOutUsageForCustomer {
    customerId: string;
    dimensionId: string;
    businessID: string;
    /**
     * Bytes sent out by every instance of the customer metered on the dimension, unrounded
     */
    recordValue: number;
    instanceIds: Array<string>;
}

/**
 * Turns the outbound network traffic (`NetworkOut`) of the EC2 instances inside a customers
 * account into billable usage.
 *
 * Instances opt in through tags: `meteringcoDimensionId` holds the comma separated list of dimensions
 * the instance is metered on and `meteringcoCustomerId` names the customer which owns it. An instance
 * without a customer tag, or whose dimension list does not hold the dimension the run is for, is
 * not part of the run.
 *
 * Power state is irrelevant, bytes which left a machine while it was up are owed for even once the
 * machine is stopped or terminated, so instances are not filtered by their state.
 *
 * The bytes every qualifying instance of a customer sent are added together into the single figure
 * recorded for that customer against the dimension of the run, in bytes, neither rounded nor
 * converted into a larger unit.
 */
@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.instanceNetworkOut)
    async readOperationJob({ data: { scheduleParameters, businessID, subject, rate } }: Job<SchedulerEntity>) {
        if (!scheduleParameters || !('iamRoleArn' in scheduleParameters)) {
            throw new BadRequestException('Iam role arn not found');
        }
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        Ec2NetworkOutDataGathererService.logger.log(
            'Processing Automated EC2 outbound network traffic gathering event, logging inputs',
            JSON.stringify({
                rate,
                businessID,
                externalId,
                region,
                dimensionId,
                subject,
            }),
        );

        const usageForCustomers = await Ec2NetworkOutDataGathererService.gatherNetworkOutUsage({
            iamRoleArn,
            externalId,
            region,
            dimensionId,
            businessID,
        });

        usageForCustomers.forEach(({ customerId, recordValue, instanceIds }) => {
            const entity = new StandardMeasurementEntity({
                businessID,
                dimensionId,
                metadata: {
                    InstanceIds: JSON.stringify(instanceIds),
                    InstanceCount: instanceIds.length,
                    MetricName: NETWORK_OUT_METRIC_NAME,
                    Namespace: EC2_METRIC_NAMESPACE,
                    Statistic: SUM_STATISTIC,
                    Region: region,
                },
                recordValue,
                customerId,
                _measurement: UsageEntity._measurement,
            });
            StandardMeasurementEntity.publish(entity);
        });

        Ec2NetworkOutDataGathererService.logger.log(
            'Finished collecting EC2 outbound network traffic data',
            JSON.stringify({ dimensionId, businessID, customersBilled: usageForCustomers.length }),
        );
        return usageForCustomers;
    }

    /**
     * Reads the customers account and totals the bytes sent out, per customer, for the dimension of the run.
     */
    static async gatherNetworkOutUsage({
        iamRoleArn,
        externalId,
        region,
        dimensionId,
        businessID,
        endTime = new Date(),
    }: {
        iamRoleArn: string;
        externalId?: string;
        region: string;
        dimensionId: string;
        businessID?: string;
        endTime?: Date;
    }): Promise<Array<NetworkOutUsageForCustomer>> {
        const credentials = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        // Every instance carrying the dimension tag, whatever its power state: a machine which has
        // since been stopped or terminated still sent what it sent while it was up.
        const instanceList = await getInstanceWithFilters(region, credentials, [
            { Name: 'tag-key', Values: [DIMENSION_TAG_KEY] },
        ]);

        const meteredInstances = (instanceList || []).filter((instance) => {
            const tags = instance?.Tags || [];
            const dimensionTag = tags.find(({ Key }) => Key === DIMENSION_TAG_KEY);
            const customerTag = tags.find(({ Key }) => Key === CUSTOMER_TAG_KEY);
            if (!dimensionTag || !customerTag || !customerTag.Value) {
                return false;
            }
            const meteredDimensionIds = (dimensionTag.Value || '').split(',').map((value) => value.trim());
            return meteredDimensionIds.includes(dimensionId);
        });

        Ec2NetworkOutDataGathererService.logger.log(
            'Instances metered on dimension',
            JSON.stringify({
                dimensionId,
                instancesFound: (instanceList || []).length,
                instancesMetered: meteredInstances.length,
            }),
        );

        if (!meteredInstances.length) {
            return [];
        }

        const startTime = new Date(endTime.getTime() - NETWORK_OUT_LOOKBACK_IN_MS);
        const metricTotals = await getInstanceMetricTotals({
            region,
            credentials,
            instanceIds: meteredInstances.map(({ InstanceId }) => InstanceId),
            startTime,
            endTime,
            metricName: NETWORK_OUT_METRIC_NAME,
            namespace: EC2_METRIC_NAMESPACE,
            statistic: SUM_STATISTIC,
            period: NETWORK_OUT_PERIOD_IN_SECONDS,
        });

        // One customer can run several instances on the same dimension, what each of them sent adds
        // into the single figure for that customer.
        const usageForCustomers = new Map<string, NetworkOutUsageForCustomer>();
        meteredInstances.forEach((instance) => {
            const customerId = (instance?.Tags || []).find(({ Key }) => Key === CUSTOMER_TAG_KEY)?.Value;
            const metricTotal = metricTotals[instance?.InstanceId];
            if (!metricTotal || !metricTotal.datapointCount) {
                // CloudWatch reported no observation for the instance, there is nothing to bill for it
                return;
            }
            const usageForCustomer = usageForCustomers.get(customerId) || {
                customerId,
                dimensionId,
                businessID,
                recordValue: 0,
                instanceIds: [],
            };
            usageForCustomer.recordValue += metricTotal.total;
            usageForCustomer.instanceIds.push(instance.InstanceId);
            usageForCustomers.set(customerId, usageForCustomer);
        });

        return Array.from(usageForCustomers.values());
    }

    @OnQueueFailed({ name: infrastructureType.instanceNetworkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 outbound network traffic',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
