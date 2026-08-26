import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
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
    getInstanceNetworkOutBytes,
    getInstancesNetworkOutBytes,
    getMetricWindow,
    MetricTotal,
    MetricWindow,
} from '../../utils/aws/awsCloudwatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';

/**
 * How many machines are read from CloudWatch at once. Estates hold far more
 * machines than a single business tends to have, so the reads are batched rather
 * than fired all at once.
 */
const READ_CONCURRENCY = 10;

/**
 * How many times a listing of the estate is attempted. EC2 throttles callers
 * which walk a large estate, and a throttled page is a transient condition
 * rather than an answer.
 */
const LIST_ATTEMPTS = 6;

/**
 * One customer's outbound traffic for a run: the bytes every one of their
 * machines sent, added together.
 */
interface CustomerNetworkOut {
    customerId: string;
    /**
     * Bytes sent out, unrounded and unconverted.
     */
    bytesSent: number;
    /**
     * Whether CloudWatch held any observation at all for this customer's
     * machines. A machine which published nothing is not the same as a machine
     * which published zero, so a customer nothing was observed for is not
     * billed rather than billed for zero.
     */
    observed: boolean;
    instanceIds: string[];
}

@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);
    /**
     * The tag a machine lists the dimensions it is metered on in, comma
     * separated, so one machine can be metered on several dimensions.
     */
    public static readonly dimensionTagKey = 'meteringcoDimensionId';
    /**
     * The tag naming the customer a machine belongs to.
     */
    public static readonly customerTagKey = 'meteringcoCustomerId';

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
            'Processing Automated EC2 outbound network traffic gathering event, logging inputs',
            JSON.stringify({ rate, businessID, externalId, subject, dimensionId, region }),
        );
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });
        const lookupRegion = region ? region : 'us-east-1';

        // Every machine which opted into metering, whatever its power state.
        // A machine which has since been stopped or torn down still sent
        // whatever it sent while it was up, and its customer owes for it.
        const instanceList = await Ec2NetworkOutDataGathererService.listMeteredInstances(lookupRegion, creds);

        const meteredInstances = (instanceList ?? []).filter(
            (instance) =>
                instance?.InstanceId && Ec2NetworkOutDataGathererService.isMeteredOnDimension(instance, dimensionId),
        );
        Ec2NetworkOutDataGathererService.logger.log(
            `Found ${meteredInstances.length} instance(s) metered on dimension ${dimensionId}`,
        );
        if (!meteredInstances.length) {
            Ec2NetworkOutDataGathererService.logger.log('No instances metered on this dimension, nothing to record');
            return;
        }

        const cloudWatchClient = new CloudWatchClient({
            region: lookupRegion,
            credentials: creds,
            maxAttempts: 10,
        });
        const window = getMetricWindow();
        const bytesSentPerInstance = await Ec2NetworkOutDataGathererService.readNetworkOut(
            meteredInstances.map(({ InstanceId }) => InstanceId),
            window,
            cloudWatchClient,
        );

        const perCustomer: Record<string, CustomerNetworkOut> = {};
        meteredInstances.forEach((instance) => {
            const customerId = Ec2NetworkOutDataGathererService.getTagValue(
                instance,
                Ec2NetworkOutDataGathererService.customerTagKey,
            );
            const { total, datapointCount } = bytesSentPerInstance[instance.InstanceId] ?? {
                total: 0,
                datapointCount: 0,
            };
            const record = perCustomer[customerId] ?? {
                customerId,
                bytesSent: 0,
                observed: false,
                instanceIds: [],
            };
            // Several machines of the same customer on the same dimension add
            // into that customer's single figure for the run.
            record.bytesSent += total;
            record.observed = record.observed || datapointCount > 0;
            record.instanceIds.push(instance.InstanceId);
            perCustomer[customerId] = record;
        });

        const results = Object.values(perCustomer)
            .filter(({ observed }) => observed)
            .map(({ customerId, bytesSent, instanceIds }) => {
                const entity = new StandardMeasurementEntity({
                    businessID,
                    dimensionId,
                    customerId,
                    // Bytes, exactly as they were sent: neither rounded nor
                    // converted into a larger unit.
                    recordValue: bytesSent,
                    metadata: {
                        region: lookupRegion,
                        metricName: 'NetworkOut',
                        instanceCount: instanceIds.length,
                    },
                    _measurement: UsageEntity._measurement,
                });
                StandardMeasurementEntity.publish(entity);
                return entity;
            });

        Ec2NetworkOutDataGathererService.logger.log(
            `Finished collecting EC2 outbound network traffic for ${results.length} customer(s)`,
        );
        return results;
    }

    /**
     * The bytes each machine sent out over the window.
     *
     * A fleet is read in batches, one call covering many machines. Should a
     * batched read not be answered, the machines are read one series at a time
     * instead, because an unread machine is traffic a customer would not be
     * charged for.
     */
    private static async readNetworkOut(
        instanceIds: string[],
        window: MetricWindow,
        cloudWatchClient: CloudWatchClient,
    ): Promise<Record<string, MetricTotal>> {
        try {
            return await getInstancesNetworkOutBytes({ instanceIds, window, cloudWatchClient });
        } catch (error) {
            Ec2NetworkOutDataGathererService.logger.warn(
                `Batched read of outbound traffic failed, falling back to reading one machine at a time: ${error?.message}`,
            );
        }
        const totals: Record<string, MetricTotal> = {};
        for (let index = 0; index < instanceIds.length; index += READ_CONCURRENCY) {
            const batch = instanceIds.slice(index, index + READ_CONCURRENCY);
            const readings = await Promise.all(
                batch.map(async (instanceId) => ({
                    instanceId,
                    reading: await getInstanceNetworkOutBytes({ instanceId, window, cloudWatchClient }),
                })),
            );
            readings.forEach(({ instanceId, reading }) => {
                totals[instanceId] = reading;
            });
        }
        return totals;
    }

    /**
     * Every machine in the region carrying the metering dimension tag, whatever
     * its power state.
     */
    private static async listMeteredInstances(region: string, creds: any): Promise<any[]> {
        let lastError;
        for (let attempt = 1; attempt <= LIST_ATTEMPTS; attempt += 1) {
            try {
                return await getInstanceWithFilters(
                    region,
                    creds,
                    [{ Name: 'tag-key', Values: [Ec2NetworkOutDataGathererService.dimensionTagKey] }],
                    { maxAttempts: 10 },
                );
            } catch (error) {
                lastError = error;
                if (/Invalid IAM role/i.test(error?.message ?? '')) {
                    throw error;
                }
                Ec2NetworkOutDataGathererService.logger.warn(
                    `Listing instances failed on attempt ${attempt} of ${LIST_ATTEMPTS}: ${error?.message}`,
                );
                if (attempt < LIST_ATTEMPTS) {
                    await new Promise((resolve) => setTimeout(resolve, 200 * 2 ** (attempt - 1)));
                }
            }
        }
        throw lastError;
    }

    /**
     * A machine is part of a run when it names the customer it belongs to and
     * lists the dimension the run is for.
     */
    private static isMeteredOnDimension(instance: any, dimensionId: string): boolean {
        const customerId = Ec2NetworkOutDataGathererService.getTagValue(
            instance,
            Ec2NetworkOutDataGathererService.customerTagKey,
        );
        if (!customerId) {
            return false;
        }
        const dimensionTag = Ec2NetworkOutDataGathererService.getTagValue(
            instance,
            Ec2NetworkOutDataGathererService.dimensionTagKey,
        );
        if (!dimensionTag) {
            return false;
        }
        return dimensionTag
            .split(',')
            .map((value) => value.trim())
            .includes(dimensionId);
    }

    private static getTagValue(instance: any, key: string): string | undefined {
        const tag = (instance?.Tags ?? []).find(({ Key }) => Key === key);
        const value = typeof tag?.Value === 'string' ? tag.Value.trim() : tag?.Value;
        return value ? value : undefined;
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
