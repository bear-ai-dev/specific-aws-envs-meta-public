import {
    CloudWatchClient,
    Datapoint,
    GetMetricDataCommand,
    GetMetricStatisticsCommand,
    MetricDataQuery,
    MetricDataResult,
    Statistic,
    Dimension as MetricDimension,
} from '@aws-sdk/client-cloudwatch';
import { Logger } from '@nestjs/common';

const logger = new Logger('AwsCloudwatch');

/**
 * The namespace AWS publishes EC2 instance level metrics under
 */
export const EC2_METRIC_NAMESPACE = 'AWS/EC2';
/**
 * The metric holding the number of bytes sent out (egress) by an EC2 instance
 */
export const NETWORK_OUT_METRIC_NAME = 'NetworkOut';
/**
 * The metric holding the number of bytes received (ingress) by an EC2 instance
 */
export const NETWORK_IN_METRIC_NAME = 'NetworkIn';

/**
 * The smallest period CloudWatch keeps EC2 network metrics at without detailed monitoring
 */
export const DEFAULT_METRIC_PERIOD_IN_SECONDS = 300;

export interface MetricSumResult {
    /**
     * The aggregated value of every datapoint CloudWatch reported inside of the window
     */
    total: number;
    /**
     * The number of datapoints CloudWatch reported inside of the window.
     * A series which reported nothing at all has no datapoints, which is different from a
     * series which reported a zero.
     */
    datapointCount: number;
}

export interface MetricStatisticsRequest {
    region: string;
    credentials?: any;
    namespace?: string;
    metricName: string;
    dimensions: MetricDimension[];
    startTime: Date;
    endTime: Date;
    periodInSeconds?: number;
    statistic?: Statistic | string;
}

/**
 * Reads a single CloudWatch series and adds up every datapoint inside of the requested window.
 *
 * CloudWatch identifies a series by its complete dimension set, so the dimensions passed in have
 * to be the exact set the metric is published with (`InstanceId` for `AWS/EC2` network metrics).
 */
export const getMetricSum = async ({
    region,
    credentials,
    namespace = EC2_METRIC_NAMESPACE,
    metricName,
    dimensions,
    startTime,
    endTime,
    periodInSeconds = DEFAULT_METRIC_PERIOD_IN_SECONDS,
    statistic = 'Sum',
}: MetricStatisticsRequest): Promise<MetricSumResult> => {
    const cloudwatchClient = new CloudWatchClient({
        region,
        credentials,
        maxAttempts: 10,
    });
    const response = await cloudwatchClient.send(
        new GetMetricStatisticsCommand({
            Namespace: namespace,
            MetricName: metricName,
            Dimensions: dimensions,
            StartTime: startTime,
            EndTime: endTime,
            Period: periodInSeconds,
            Statistics: [statistic as Statistic],
        }),
    );
    const datapoints: Datapoint[] = response?.Datapoints ? response.Datapoints : [];
    const total = datapoints.reduce((accumulator, datapoint) => {
        const value = datapoint[statistic as string];
        return accumulator + (typeof value === 'number' ? value : 0);
    }, 0);
    return { total, datapointCount: datapoints.length };
};

export interface InstanceMetricRequest {
    region: string;
    credentials?: any;
    instanceIds: string[];
    startTime: Date;
    endTime: Date;
    periodInSeconds?: number;
    metricName?: string;
    namespace?: string;
    statistic?: Statistic | string;
}

/**
 * The number of series a single GetMetricData request is allowed to carry
 */
export const MAX_METRIC_DATA_QUERIES = 500;

/**
 * Reads the number of bytes each of the given EC2 instances sent out over the window.
 *
 * The series are read in batches with `GetMetricData`, so an estate with thousands of instances is
 * a handful of calls rather than one call per instance. Every instance asked about is answered,
 * whether or not CloudWatch held an observation for it, so the caller can tell an instance which
 * reported zero bytes apart from an instance which reported nothing at all. The values are raw
 * bytes, exactly as CloudWatch reported them, neither rounded nor scaled.
 */
export const getInstanceNetworkOutBytes = async ({
    region,
    credentials,
    instanceIds,
    startTime,
    endTime,
    periodInSeconds = DEFAULT_METRIC_PERIOD_IN_SECONDS,
    metricName = NETWORK_OUT_METRIC_NAME,
    namespace = EC2_METRIC_NAMESPACE,
    statistic = 'Sum',
}: InstanceMetricRequest): Promise<Record<string, MetricSumResult>> => {
    const uniqueInstanceIds = Array.from(
        new Set((instanceIds ? instanceIds : []).filter((instanceId) => !!instanceId)),
    );
    const cloudwatchClient = new CloudWatchClient({
        region,
        credentials,
        maxAttempts: 10,
    });
    const results: Record<string, MetricSumResult> = {};
    for (let offset = 0; offset < uniqueInstanceIds.length; offset += MAX_METRIC_DATA_QUERIES) {
        const batch = uniqueInstanceIds.slice(offset, offset + MAX_METRIC_DATA_QUERIES);
        // A CloudWatch query id has to start with a lowercase letter and hold nothing but letters,
        // digits and underscores, so an instance id cannot be used as one.
        const instanceIdByQueryId = batch.reduce(
            (accumulator, instanceId, index) => {
                accumulator[`m${index}`] = instanceId;
                return accumulator;
            },
            {} as Record<string, string>,
        );
        const queries: MetricDataQuery[] = Object.keys(instanceIdByQueryId).map((queryId) => ({
            Id: queryId,
            MetricStat: {
                Metric: {
                    Namespace: namespace,
                    MetricName: metricName,
                    Dimensions: [{ Name: 'InstanceId', Value: instanceIdByQueryId[queryId] }],
                },
                Period: periodInSeconds,
                Stat: statistic as string,
            },
        }));
        batch.forEach((instanceId) => {
            results[instanceId] = { total: 0, datapointCount: 0 };
        });
        let nextToken: string | undefined;
        do {
            const response = await cloudwatchClient.send(
                new GetMetricDataCommand({
                    MetricDataQueries: queries,
                    StartTime: startTime,
                    EndTime: endTime,
                    NextToken: nextToken,
                }),
            );
            nextToken = response?.NextToken;
            const metricDataResults: MetricDataResult[] = response?.MetricDataResults ? response.MetricDataResults : [];
            metricDataResults.forEach(({ Id, Values }) => {
                const instanceId = instanceIdByQueryId[Id];
                if (!instanceId || !Values) {
                    return;
                }
                const result = results[instanceId];
                Values.forEach((value) => {
                    if (typeof value === 'number') {
                        result.total += value;
                        result.datapointCount += 1;
                    }
                });
            });
        } while (nextToken);
    }
    logger.log(`Read ${metricName} for ${uniqueInstanceIds.length} instance(s) in ${region}`);
    return results;
};
