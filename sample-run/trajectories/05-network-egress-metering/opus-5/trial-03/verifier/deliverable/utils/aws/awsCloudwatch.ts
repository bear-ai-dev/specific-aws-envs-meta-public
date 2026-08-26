import { CloudWatchClient, GetMetricDataCommand, GetMetricStatisticsCommand } from '@aws-sdk/client-cloudwatch';
import { Logger } from '@nestjs/common';
import { retryWithBackoff } from '../shared/utils.js';

const logger = new Logger('awsCloudwatch');

/**
 * The granularity, in seconds, CloudWatch buckets EC2 network metrics into.
 */
export const CLOUDWATCH_PERIOD_IN_SECONDS = 300;

/**
 * CloudWatch does not publish an observation the instant it happens, an
 * observation for a five minute period only becomes readable a few minutes
 * after that period closed. Reading only the five minutes which just elapsed
 * would therefore read a window AWS has not filled in yet, so the window is
 * widened backwards by a couple of periods.
 */
export const CLOUDWATCH_LOOKBACK_PERIODS = 3;

export interface MetricWindow {
    startTime: Date;
    endTime: Date;
    period: number;
}

/**
 * The window of time a metered run reads observations for.
 */
export const getMetricWindow = (
    endTime: Date = new Date(),
    lookbackPeriods: number = CLOUDWATCH_LOOKBACK_PERIODS,
    period: number = CLOUDWATCH_PERIOD_IN_SECONDS,
): MetricWindow => ({
    startTime: new Date(endTime.getTime() - lookbackPeriods * period * 1000),
    endTime,
    period,
});

export interface MetricTotal {
    /**
     * The summed value of every observation inside the window.
     */
    total: number;
    /**
     * How many observations the window held. A series which reported nothing at
     * all is not the same thing as a series which reported zero, so callers can
     * tell the two apart.
     */
    datapointCount: number;
}

/**
 * Total of a single CloudWatch series over a window.
 *
 * The dimensions passed in have to be the complete dimension set of the series,
 * AWS/EC2 network metrics are published per InstanceId, so a query which names
 * no instance names no series.
 */
export const getMetricSum = async ({
    region,
    creds,
    namespace,
    metricName,
    dimensions,
    window = getMetricWindow(),
    cloudWatchClient,
}: {
    region?: string;
    creds?: any;
    namespace: string;
    metricName: string;
    dimensions: Array<{ Name: string; Value: string }>;
    window?: MetricWindow;
    cloudWatchClient?: CloudWatchClient;
}): Promise<MetricTotal> => {
    const client =
        cloudWatchClient ??
        new CloudWatchClient({
            region,
            credentials: creds,
            // Metering reads one series per machine, which is exactly the shape
            // of traffic AWS throttles, so give the SDK room to back off.
            maxAttempts: 10,
        });
    const { startTime, endTime, period } = window;
    const response = await retryWithBackoff(() =>
        client.send(
            new GetMetricStatisticsCommand({
                Namespace: namespace,
                MetricName: metricName,
                Dimensions: dimensions,
                StartTime: startTime,
                EndTime: endTime,
                Period: period,
                Statistics: ['Sum'],
            }),
        ),
    );
    const datapoints = response?.Datapoints ?? [];
    const total = datapoints.reduce((acc, { Sum }) => acc + (Sum ?? 0), 0);
    return { total, datapointCount: datapoints.length };
};

/**
 * The bytes an EC2 instance sent out over the window. Bytes leaving the
 * machine, `NetworkOut`, not the bytes arriving at it.
 */
export const getInstanceNetworkOutBytes = async ({
    instanceId,
    region,
    creds,
    window = getMetricWindow(),
    cloudWatchClient,
}: {
    instanceId: string;
    region?: string;
    creds?: any;
    window?: MetricWindow;
    cloudWatchClient?: CloudWatchClient;
}): Promise<MetricTotal> => {
    try {
        return await getMetricSum({
            region,
            creds,
            namespace: 'AWS/EC2',
            metricName: 'NetworkOut',
            dimensions: [{ Name: 'InstanceId', Value: instanceId }],
            window,
            cloudWatchClient,
        });
    } catch (error) {
        logger.error(`Failed to read NetworkOut for instance ${instanceId}`, error);
        throw error;
    }
};

/**
 * How many series one `GetMetricData` call asks about. AWS accepts up to 500
 * queries in a call; batching is what keeps a fleet of machines to a handful of
 * calls instead of one call per machine.
 */
export const METRIC_DATA_BATCH_SIZE = 100;

/**
 * The bytes each of a set of EC2 instances sent out over the window, keyed by
 * instance id.
 *
 * Read with `GetMetricData` so a fleet costs a few calls rather than one call
 * per machine. Every instance asked about is present in the answer: an instance
 * whose series held no observation comes back with a zero total and no
 * datapoints, which is not the same as an observed zero.
 */
export const getInstancesNetworkOutBytes = async ({
    instanceIds,
    region,
    creds,
    window = getMetricWindow(),
    cloudWatchClient,
    batchSize = METRIC_DATA_BATCH_SIZE,
}: {
    instanceIds: string[];
    region?: string;
    creds?: any;
    window?: MetricWindow;
    cloudWatchClient?: CloudWatchClient;
    batchSize?: number;
}): Promise<Record<string, MetricTotal>> => {
    const client =
        cloudWatchClient ??
        new CloudWatchClient({
            region,
            credentials: creds,
            maxAttempts: 10,
        });
    const { startTime, endTime, period } = window;
    const totals: Record<string, MetricTotal> = instanceIds.reduce((acc, instanceId) => {
        acc[instanceId] = { total: 0, datapointCount: 0 };
        return acc;
    }, {});

    for (let offset = 0; offset < instanceIds.length; offset += batchSize) {
        const batch = instanceIds.slice(offset, offset + batchSize);
        // A query id has to start with a lowercase letter and hold only
        // letters, digits and underscores, so an instance id cannot be one.
        const idToInstance: Record<string, string> = {};
        const queries = batch.map((instanceId, index) => {
            const queryId = `m${index}`;
            idToInstance[queryId] = instanceId;
            return {
                Id: queryId,
                MetricStat: {
                    Metric: {
                        Namespace: 'AWS/EC2',
                        MetricName: 'NetworkOut',
                        Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                    },
                    Period: period,
                    Stat: 'Sum',
                },
                ReturnData: true,
            };
        });

        let nextToken: string | undefined;
        do {
            const response = await retryWithBackoff(() =>
                client.send(
                    new GetMetricDataCommand({
                        MetricDataQueries: queries,
                        StartTime: startTime,
                        EndTime: endTime,
                        NextToken: nextToken,
                    }),
                ),
            );
            (response?.MetricDataResults ?? []).forEach(({ Id, Values }) => {
                const instanceId = idToInstance[Id];
                if (!instanceId) {
                    return;
                }
                const values = Values ?? [];
                totals[instanceId] = {
                    total: totals[instanceId].total + values.reduce((acc, value) => acc + (value ?? 0), 0),
                    datapointCount: totals[instanceId].datapointCount + values.length,
                };
            });
            nextToken = response?.NextToken;
        } while (nextToken);
    }
    return totals;
};
