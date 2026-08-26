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
    METRIC_PERIOD_IN_SECONDS,
    NETWORK_OUT_METRIC_NAME,
    getNetworkOutBytesForInstances,
    metricCollectionWindow,
} from '../../utils/aws/awsCloudWatch.js';
import { getInstanceWithFilters } from '../../utils/aws/awsEc2.js';
import { sleep } from '../../utils/shared/utils.js';
import { Ec2NetworkOutDataGathererDto } from './dto/ec2NetworkOutDataGatherer.dto.js';

/**
 * The tag a customer's machine carries to say which MeteringCo dimensions it is metered on.
 * It holds a comma separated list, so one machine can be metered on several dimensions.
 */
export const METERINGCO_DIMENSION_TAG = 'meteringcoDimensionId';
/**
 * The tag a customer's machine carries to say whose machine it is.
 */
export const METERINGCO_CUSTOMER_TAG = 'meteringcoCustomerId';

type TaggedInstance = {
    instanceId: string;
    customerId: string;
    /**
     * The power state of the machine, which is recorded for context only: it has nothing to do
     * with what is owed.
     */
    state?: string;
};

/**
 * Turns the outbound network traffic of the EC2 instances in a customer estate into billable
 * usage: the bytes each machine sent onto the network over the interval, summed per customer
 * and recorded against the dimension the run is for.
 */
@Processor('scheduler_queue')
export class Ec2NetworkOutDataGathererService {
    private static readonly logger = new Logger(Ec2NetworkOutDataGathererService.name);
    constructor() {}

    @Process(infrastructureType.instanceNetworkOut)
    async readOperationJob({ data }: Job<SchedulerEntity>) {
        const { businessID, subject, rate } = data ?? ({} as SchedulerEntity);
        // A run always carries its parameters on the schedule entity, but tolerate them
        // being handed in on their own as well.
        const scheduleParameters = (data?.scheduleParameters ?? data) as unknown as Ec2NetworkOutDataGathererDto;
        if (!scheduleParameters || !('iamRoleArn' in scheduleParameters) || !scheduleParameters.iamRoleArn) {
            throw new BadRequestException(
                scheduleParameters,
                'Invalid Schedule Parameters sent to the EC2 network out data system, iamRoleArn is required',
            );
        }
        const { iamRoleArn, externalId, dimensionId, region } = scheduleParameters;
        Ec2NetworkOutDataGathererService.logger.log(
            'Processing Automated EC2 network out gathering event, logging inputs',
            JSON.stringify({ rate, businessID, iamRoleArn, externalId, dimensionId, region, subject }),
        );
        if (!dimensionId) {
            throw new BadRequestException(
                scheduleParameters,
                'Invalid Schedule Parameters sent to the EC2 network out data system, dimensionId is required',
            );
        }

        // Read the customer estate by assuming the role the customer granted for it.
        const creds = fromTemporaryCredentials({
            params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
            clientConfig: { region: 'us-east-1' },
        });

        // Every machine that opted into metering carries the dimension tag. The tag holds a
        // list, so it cannot be matched on the value server side; the list is split below.
        // The power state is not filtered on either: a machine that has since been stopped or
        // torn down still sent whatever it sent while it was up and its customer owes for it.
        const instanceList = await Ec2NetworkOutDataGathererService.withRetries(() =>
            getInstanceWithFilters(region, creds, [{ Name: 'tag-key', Values: [METERINGCO_DIMENSION_TAG] }]),
        );

        const meteredInstances = Ec2NetworkOutDataGathererService.instancesMeteredOnDimension(
            instanceList,
            dimensionId,
        );
        Ec2NetworkOutDataGathererService.logger.log(
            `Found ${meteredInstances.length} instance(s) metered on dimension ${dimensionId} out of ${
                instanceList?.length ?? 0
            } tagged instance(s)`,
        );

        const { startTime, endTime } = metricCollectionWindow();
        const networkOutByInstance = await getNetworkOutBytesForInstances({
            region,
            creds,
            instanceIds: meteredInstances.map(({ instanceId }) => instanceId),
            startTime,
            endTime,
        });

        // One customer can be running several machines on the same dimension, and what each of
        // them sent adds into that customer's single figure for the run.
        const usageByCustomer = meteredInstances.reduce<
            Record<string, { bytes: number; instanceIds: string[]; observations: number }>
        >((acc, { instanceId, customerId }) => {
            const metric = networkOutByInstance[instanceId];
            // CloudWatch answers a window that held no observation with no datapoint at all.
            // A machine nothing was observed for is not a machine that sent zero bytes, so it
            // does not put its customer on the bill by itself.
            if (!metric || metric.datapointCount === 0) {
                return acc;
            }
            const current = acc[customerId] ?? { bytes: 0, instanceIds: [], observations: 0 };
            current.bytes += metric.total;
            current.instanceIds.push(instanceId);
            current.observations += metric.datapointCount;
            acc[customerId] = current;
            return acc;
        }, {});

        const measurements = Object.entries(usageByCustomer).map(
            ([customerId, { bytes, instanceIds, observations }]) => {
                // The figure is the bytes the customer's machines sent, as bytes: not rounded and
                // not converted into any larger unit.
                const entity = new StandardMeasurementEntity({
                    businessID,
                    dimensionId,
                    customerId,
                    recordValue: bytes,
                    metadata: {
                        region,
                        metricName: NETWORK_OUT_METRIC_NAME,
                        unit: 'Bytes',
                        instanceIds: instanceIds.join(','),
                        instanceCount: instanceIds.length,
                        observationCount: observations,
                        intervalStart: startTime.toISOString(),
                        intervalEnd: endTime.toISOString(),
                        periodInSeconds: METRIC_PERIOD_IN_SECONDS,
                    },
                    _measurement: UsageEntity._measurement,
                });
                StandardMeasurementEntity.publish(entity);
                return entity;
            },
        );

        Ec2NetworkOutDataGathererService.logger.log(
            `Finished collecting EC2 network out data for dimension ${dimensionId}, recorded usage for ${measurements.length} customer(s)`,
        );
        return measurements;
    }

    /**
     * Reading a whole estate is a rate limited operation, so a read that comes back as a
     * failure is given a second and third chance before the run is given up on.
     */
    private static async withRetries<T>(operation: () => Promise<T>, attempts = 3, delayInMs = 500): Promise<T> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                Ec2NetworkOutDataGathererService.logger.warn(
                    `Attempt ${attempt} of ${attempts} to read the customer estate failed: ${error?.message}`,
                );
                if (attempt < attempts) {
                    await sleep(delayInMs * attempt);
                }
            }
        }
        throw lastError;
    }

    /**
     * The machines a run is about: those whose dimension tag lists the dimension the run is
     * for and which name the customer they belong to. A machine with no customer tag, or whose
     * list does not include the dimension, is no part of the run.
     */
    static instancesMeteredOnDimension(instanceList: any[], dimensionId: string): TaggedInstance[] {
        return (instanceList ?? []).reduce<TaggedInstance[]>((acc, instance) => {
            const tags: { Key?: string; Value?: string }[] = instance?.Tags ?? [];
            const dimensionTag = tags.find(({ Key }) => Key === METERINGCO_DIMENSION_TAG);
            const customerTag = tags.find(({ Key }) => Key === METERINGCO_CUSTOMER_TAG);
            const customerId = customerTag?.Value?.trim();
            if (!dimensionTag?.Value || !customerId) {
                return acc;
            }
            const meteredDimensions = dimensionTag.Value.split(',').map((value) => value.trim());
            if (!meteredDimensions.includes(dimensionId) || !instance?.InstanceId) {
                return acc;
            }
            acc.push({
                instanceId: instance.InstanceId,
                customerId,
                state: instance?.State?.Name ?? instance?.State,
            });
            return acc;
        }, []);
    }

    @OnQueueFailed({ name: infrastructureType.instanceNetworkOut })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to measure EC2 network out data for account',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
