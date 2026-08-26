import { CloudWatchClient, GetMetricStatisticsCommand, Statistic } from '@aws-sdk/client-cloudwatch';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types/dist-types/identity';
import { Logger } from '@nestjs/common';

const logger = new Logger('awsCloudWatch');

/**
 * The `AWS/EC2` namespace publishes the bytes an instance sent onto the network as `NetworkOut`.
 * `NetworkIn` is the mirror of it (bytes received) and is deliberately not what is metered here.
 */
export const NETWORK_OUT_METRIC_NAME = 'NetworkOut';
export const EC2_METRIC_NAMESPACE = 'AWS/EC2';

/**
 * EC2 publishes its network metrics on a five minute grain, which is also the grain
 * the metering schedules run on.
 */
export const METRIC_PERIOD_IN_SECONDS = 300;
const MS_PER_SECOND = 1000;

/**
 * CloudWatch only becomes readable a few minutes after the observation it describes,
 * so the window a run reads is the period the run covers plus one period of slack.
 * Without the slack a five minute run would always read an interval CloudWatch has
 * not published yet and would meter nothing at all.
 */
export const METRIC_COLLECTION_LAG_IN_SECONDS = METRIC_PERIOD_IN_SECONDS;

/**
 * The interval a data gathering run reads out of CloudWatch.
 */
export const metricCollectionWindow = (
    endTime: Date = new Date(),
    intervalInSeconds: number = METRIC_PERIOD_IN_SECONDS,
): { startTime: Date; endTime: Date } => ({
    startTime: new Date(endTime.getTime() - (intervalInSeconds + METRIC_COLLECTION_LAG_IN_SECONDS) * MS_PER_SECOND),
    endTime,
});

export type MetricTotal = {
    /**
     * The summed value of every datapoint CloudWatch held for the series inside the window.
     */
    total: number;
    /**
     * How many datapoints backed that total. CloudWatch answers a window that holds no
     * observation with no datapoint at all, so `0` means "nothing was observed" which is
     * not the same statement as "zero was observed".
     */
    datapointCount: number;
    unit?: string;
};

export const buildCloudWatchClient = (region: string, creds: AwsCredentialIdentityProvider): CloudWatchClient =>
    new CloudWatchClient({
        region,
        credentials: creds,
        // Metering an estate is a fan out of one read per resource, which is exactly the
        // shape of call CloudWatch throttles, so the client is given room to ride it out.
        maxAttempts: 10,
    });

/**
 * Total the observations a single EC2 instance published for a metric over a window.
 *
 * A series in `AWS/EC2` is identified by its whole dimension set, so the `InstanceId`
 * dimension is always named: a query without it names no series and reads nothing rather
 * than reading the whole fleet.
 */
export const getInstanceMetricTotal = async ({
    client,
    instanceId,
    startTime,
    endTime,
    metricName = NETWORK_OUT_METRIC_NAME,
    namespace = EC2_METRIC_NAMESPACE,
    period = METRIC_PERIOD_IN_SECONDS,
}: {
    client: CloudWatchClient;
    instanceId: string;
    startTime: Date;
    endTime: Date;
    metricName?: string;
    namespace?: string;
    period?: number;
}): Promise<MetricTotal> => {
    const response = await client.send(
        new GetMetricStatisticsCommand({
            Namespace: namespace,
            MetricName: metricName,
            Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
            StartTime: startTime,
            EndTime: endTime,
            Period: period,
            Statistics: [Statistic.Sum],
        }),
    );
    const datapoints = response?.Datapoints ?? [];
    const total = datapoints.reduce((acc, { Sum }) => acc + (Sum ?? 0), 0);
    logger.debug(
        `Read ${
            datapoints.length
        } ${metricName} datapoint(s) for ${instanceId} totalling ${total} between ${startTime.toISOString()} and ${endTime.toISOString()}`,
    );
    return { total, datapointCount: datapoints.length, unit: datapoints[0]?.Unit };
};

/**
 * Total the bytes each instance sent onto the network over the window, one entry per
 * instance that CloudWatch held at least one observation for.
 */
export const getNetworkOutBytesForInstances = async ({
    region,
    creds,
    instanceIds,
    startTime,
    endTime,
    concurrency = 10,
}: {
    region: string;
    creds: AwsCredentialIdentityProvider;
    instanceIds: string[];
    startTime: Date;
    endTime: Date;
    concurrency?: number;
}): Promise<Record<string, MetricTotal>> => {
    const client = buildCloudWatchClient(region, creds);
    const totals: Record<string, MetricTotal> = {};
    // Estates run far more machines than the chunk size, so the fan out is bounded
    // rather than issued all at once.
    for (let index = 0; index < instanceIds.length; index += concurrency) {
        const chunk = instanceIds.slice(index, index + concurrency);
        const results = await Promise.all(
            chunk.map(async (instanceId) => ({
                instanceId,
                metric: await getInstanceMetricTotal({ client, instanceId, startTime, endTime }),
            })),
        );
        results.forEach(({ instanceId, metric }) => {
            totals[instanceId] = metric;
        });
    }
    return totals;
};
