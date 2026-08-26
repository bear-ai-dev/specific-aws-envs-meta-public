import { CloudWatchClient, Datapoint, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { BadRequestException, Logger } from '@nestjs/common';

const logger = new Logger('awsCloudWatch');

/**
 * The namespace AWS publishes EC2 instance level metrics under
 */
export const EC2_METRIC_NAMESPACE = 'AWS/EC2';

/**
 * The metric holding the number of bytes sent out of an instance on all network interfaces
 */
export const NETWORK_OUT_METRIC_NAME = 'NetworkOut';

export interface MetricObservation {
    /**
     * The total of every observation found inside the requested window
     */
    total: number;
    /**
     * How many observations (CloudWatch datapoints) were found inside the requested window.
     * Zero means CloudWatch had nothing to say about the series, which is different from an
     * observation of zero.
     */
    datapointCount: number;
    /**
     * The unit reported by CloudWatch for the series, `Bytes` for network metrics
     */
    unit?: string;
}

/**
 * Reads a single AWS/EC2 metric series (one instance) and sums every datapoint
 * CloudWatch reports inside the window.
 *
 * A series is identified by its complete dimension set, so `InstanceId` is always sent,
 * otherwise CloudWatch matches no series at all.
 */
export const getInstanceMetricSum = async ({
    region,
    creds,
    instanceId,
    metricName = NETWORK_OUT_METRIC_NAME,
    namespace = EC2_METRIC_NAMESPACE,
    startTime,
    endTime,
    period = 300,
}: {
    region: string;
    creds?: any;
    instanceId: string;
    metricName?: string;
    namespace?: string;
    startTime: Date;
    endTime: Date;
    period?: number;
}): Promise<MetricObservation> => {
    const cloudWatchClient = new CloudWatchClient({
        region,
        credentials: creds,
        // CloudWatch throttles metric reads on large estates, so give the SDK room to back off
        maxAttempts: 10,
    });
    try {
        const response = await cloudWatchClient.send(
            new GetMetricStatisticsCommand({
                Namespace: namespace,
                MetricName: metricName,
                Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                StartTime: startTime,
                EndTime: endTime,
                Period: period,
                Statistics: ['Sum'],
            }),
        );
        const datapoints: Datapoint[] = response?.Datapoints ? response.Datapoints : [];
        const relevantDatapoints = datapoints.filter((datapoint) => typeof datapoint?.Sum === 'number');
        return {
            total: relevantDatapoints.reduce((accumulator, { Sum }) => accumulator + Sum, 0),
            datapointCount: relevantDatapoints.length,
            unit: relevantDatapoints.length ? relevantDatapoints[0].Unit : undefined,
        };
    } catch (err) {
        logger.error(`Error reading ${namespace}/${metricName} for ${instanceId}`, err);
        if (err?.Code === 'AccessDenied' || err?.name === 'AccessDenied') {
            throw new BadRequestException('Invalid IAM role or external ID');
        }
        throw err;
    }
};

/**
 * Reads the same metric for a list of instances, one series per instance, keyed by instance id.
 */
export const getInstanceMetricSums = async ({
    region,
    creds,
    instanceIds,
    metricName = NETWORK_OUT_METRIC_NAME,
    namespace = EC2_METRIC_NAMESPACE,
    startTime,
    endTime,
    period = 300,
    concurrency = 5,
}: {
    region: string;
    creds?: any;
    instanceIds: Array<string>;
    metricName?: string;
    namespace?: string;
    startTime: Date;
    endTime: Date;
    period?: number;
    concurrency?: number;
}): Promise<Record<string, MetricObservation>> => {
    const results: Record<string, MetricObservation> = {};
    const uniqueInstanceIds = Array.from(new Set(instanceIds.filter((instanceId) => !!instanceId)));
    for (let index = 0; index < uniqueInstanceIds.length; index += concurrency) {
        const batch = uniqueInstanceIds.slice(index, index + concurrency);
        // Batched to keep from being throttled by CloudWatch on large estates
        // eslint-disable-next-line no-await-in-loop
        const observations = await Promise.all(
            batch.map(async (instanceId) => ({
                instanceId,
                observation: await getInstanceMetricSum({
                    region,
                    creds,
                    instanceId,
                    metricName,
                    namespace,
                    startTime,
                    endTime,
                    period,
                }),
            })),
        );
        observations.forEach(({ instanceId, observation }) => {
            results[instanceId] = observation;
        });
    }
    return results;
};
