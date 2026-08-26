import {
    CloudWatchClient,
    Datapoint,
    Dimension,
    GetMetricStatisticsCommand,
    Statistic,
} from '@aws-sdk/client-cloudwatch';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { BadRequestException } from '@nestjs/common';

export const EC2_METRIC_NAMESPACE = 'AWS/EC2';
export const NETWORK_OUT_METRIC_NAME = 'NetworkOut';
export const DEFAULT_METRIC_PERIOD_IN_SECONDS = 300;

/**
 * How many series are read from CloudWatch at once. Estates can run thousands of
 * instances so the reads are batched instead of being fired all at the same time.
 */
const READ_CONCURRENCY = 20;

export interface MetricWindow {
    startTime: Date;
    endTime: Date;
}

interface MetricSumRequest extends MetricWindow {
    cloudWatchClient: CloudWatchClient;
    namespace: string;
    metricName: string;
    dimensions: Dimension[];
    period?: number;
}

/**
 * Adds up every datapoint a single CloudWatch series reported inside the window.
 *
 * `undefined` is returned when the series reported nothing at all in the window.
 * CloudWatch does not hand back a zero for a period it observed nothing in, so
 * neither does this: a silent series is absent from the numbers rather than a
 * zero inside them.
 */
export const getMetricSum = async ({
    cloudWatchClient,
    namespace,
    metricName,
    dimensions,
    startTime,
    endTime,
    period = DEFAULT_METRIC_PERIOD_IN_SECONDS,
}: MetricSumRequest): Promise<number | undefined> => {
    try {
        const { Datapoints } = await cloudWatchClient.send(
            new GetMetricStatisticsCommand({
                Namespace: namespace,
                MetricName: metricName,
                Dimensions: dimensions,
                StartTime: startTime,
                EndTime: endTime,
                Period: period,
                Statistics: [Statistic.Sum],
            }),
        );
        if (!Datapoints || !Datapoints.length) {
            return undefined;
        }
        return Datapoints.reduce((total: number, { Sum }: Datapoint) => total + (Sum ? Sum : 0), 0);
    } catch (err) {
        console.log('Error', err);
        if (err?.Code === 'AccessDenied' || err?.name === 'AccessDenied' || err?.name === 'AccessDeniedException') {
            throw new BadRequestException('Invalid IAM role or external ID');
        }
        throw new BadRequestException(`Error fetching ${metricName} metric statistics`);
    }
};

/**
 * Reads the `AWS/EC2` `NetworkOut` series of every instance handed in, the bytes
 * each instance sent out over the window, and returns them keyed by instance id.
 *
 * Instances whose series reported nothing in the window are left out of the
 * result entirely so callers can tell "sent nothing" apart from "never reported".
 */
export const getNetworkOutBytesByInstance = async ({
    region,
    credentials,
    instanceIds,
    startTime,
    endTime,
    period = DEFAULT_METRIC_PERIOD_IN_SECONDS,
}: MetricWindow & {
    region: string;
    credentials: AwsCredentialIdentityProvider;
    instanceIds: string[];
    period?: number;
}): Promise<Record<string, number>> => {
    const cloudWatchClient = new CloudWatchClient({ region, credentials });
    const networkOutBytesByInstance: Record<string, number> = {};
    for (let index = 0; index < instanceIds.length; index += READ_CONCURRENCY) {
        const batch = instanceIds.slice(index, index + READ_CONCURRENCY);
        // Reads inside a batch run together, batches run one after the other
        // eslint-disable-next-line no-await-in-loop
        const bytesSentPerInstance = await Promise.all(
            batch.map((instanceId) =>
                getMetricSum({
                    cloudWatchClient,
                    namespace: EC2_METRIC_NAMESPACE,
                    metricName: NETWORK_OUT_METRIC_NAME,
                    // NetworkOut is published per instance, the whole dimension set has to be named
                    dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                    startTime,
                    endTime,
                    period,
                }),
            ),
        );
        batch.forEach((instanceId, batchIndex) => {
            const bytesSent = bytesSentPerInstance[batchIndex];
            if (bytesSent !== undefined) {
                networkOutBytesByInstance[instanceId] = bytesSent;
            }
        });
    }
    return networkOutBytesByInstance;
};
