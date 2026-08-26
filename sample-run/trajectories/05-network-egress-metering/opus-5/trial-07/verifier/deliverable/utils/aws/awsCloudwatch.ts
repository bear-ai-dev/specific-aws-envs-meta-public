import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from '@aws-sdk/client-cloudwatch';

/**
 * The namespace AWS publishes the built in EC2 instance metrics under.
 */
export const EC2_METRIC_NAMESPACE = 'AWS/EC2';

/**
 * CloudWatch accepts up to 500 queries in a single GetMetricData call, batching well below that
 * keeps a single request small enough to stay comfortably inside the API request size limits while
 * still reading a large fleet in a handful of calls.
 */
const MAX_QUERIES_PER_REQUEST = 100;

/**
 * The reading of a single metric series over a window.
 *
 * `observed` separates a series which reported nothing during the window from one which reported
 * observations that happen to add up to zero, CloudWatch does not return datapoints for periods
 * where nothing was observed.
 */
export interface MetricSeriesReading {
    total: number;
    observed: boolean;
}

const chunk = <T>(items: Array<T>, size: number): Array<Array<T>> => {
    const chunks: Array<Array<T>> = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

/**
 * Reads the sum of an `AWS/EC2` metric, per instance, over a window.
 *
 * Every instance metric published by EC2 is dimensioned by `InstanceId`, so each instance is asked
 * for with its own query rather than in one aggregate query, which is also what makes the reading
 * of one instance independent from the reading of the next.
 *
 * @returns a reading keyed by instance id, instances CloudWatch holds no series for are absent.
 */
export const getInstanceMetricTotals = async ({
    region,
    credentials,
    metricName,
    instanceIds,
    startTime,
    endTime,
    periodInSeconds,
}: {
    region: string;
    credentials: any;
    metricName: string;
    instanceIds: Array<string>;
    startTime: Date;
    endTime: Date;
    periodInSeconds: number;
}): Promise<Record<string, MetricSeriesReading>> => {
    const readings: Record<string, MetricSeriesReading> = {};
    if (!instanceIds.length) {
        return readings;
    }
    // A burst of throttling from CloudWatch is normal when a large fleet is read, let the client
    // back off and retry rather than losing a customers usage for the interval.
    const cloudWatchClient = new CloudWatchClient({ region, credentials, maxAttempts: 8 });

    for (const batch of chunk(instanceIds, MAX_QUERIES_PER_REQUEST)) {
        // A query id has to start with a lowercase letter and hold only letters, digits and
        // underscores, so an instance id cannot be used as one and is mapped back afterwards.
        const instanceIdByQueryId: Record<string, string> = {};
        const metricDataQueries: Array<MetricDataQuery> = batch.map((instanceId, index) => {
            const queryId = `m${index}`;
            instanceIdByQueryId[queryId] = instanceId;
            return {
                Id: queryId,
                MetricStat: {
                    Metric: {
                        Namespace: EC2_METRIC_NAMESPACE,
                        MetricName: metricName,
                        Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
                    },
                    Period: periodInSeconds,
                    Stat: 'Sum',
                },
                ReturnData: true,
            };
        });

        let nextToken: string | undefined;
        do {
            const response = await cloudWatchClient.send(
                new GetMetricDataCommand({
                    StartTime: startTime,
                    EndTime: endTime,
                    ScanBy: 'TimestampAscending',
                    MetricDataQueries: metricDataQueries,
                    NextToken: nextToken,
                }),
            );
            (response?.MetricDataResults ?? []).forEach(({ Id, Values }) => {
                const instanceId = instanceIdByQueryId[Id];
                if (!instanceId) {
                    return;
                }
                const reading = readings[instanceId] ?? { total: 0, observed: false };
                (Values ?? []).forEach((value) => {
                    if (typeof value === 'number' && Number.isFinite(value)) {
                        reading.total += value;
                        reading.observed = true;
                    }
                });
                readings[instanceId] = reading;
            });
            nextToken = response?.NextToken;
        } while (nextToken);
    }

    return readings;
};
