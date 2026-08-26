import { CloudWatchClient, GetMetricDataCommand, MetricDataQuery } from '@aws-sdk/client-cloudwatch';
import { BadRequestException } from '@nestjs/common';

/**
 * The CloudWatch namespace EC2 publishes its instance level metrics under.
 */
export const EC2_METRIC_NAMESPACE = 'AWS/EC2';

/**
 * The CloudWatch metric holding the number of bytes sent out (egress) by an EC2 instance.
 * `NetworkIn` is the inbound counterpart and is explicitly NOT what is metered here.
 */
export const NETWORK_OUT_METRIC_NAME = 'NetworkOut';

/**
 * The dimension name CloudWatch uses to identify a single EC2 instance series.
 */
export const INSTANCE_ID_DIMENSION = 'InstanceId';

/**
 * The default statistic used when totalling a metric over a window.
 */
export const SUM_STATISTIC = 'Sum';

/**
 * CloudWatch caps the amount of metric queries which can be batched in a single
 * GetMetricData request. Keep well below the hard limit (500) so large fleets are
 * paged through in stable chunks.
 */
export const METRIC_DATA_QUERY_BATCH_SIZE = 100;

/**
 * The result of totalling a metric for a single resource over a time window.
 * `datapointCount` allows callers to tell "no observation at all" apart from "observed zero".
 */
export interface MetricTotal {
    total: number;
    datapointCount: number;
}

export interface InstanceMetricTotalsInput {
    region: string;
    credentials: any;
    instanceIds: Array<string>;
    startTime: Date;
    endTime: Date;
    metricName?: string;
    namespace?: string;
    statistic?: string;
    period?: number;
}

/**
 * Totals a per instance CloudWatch metric (for example `NetworkOut`) for every instance passed in.
 *
 * A CloudWatch series is identified by its complete dimension set, so every instance is asked for
 * by its own `InstanceId` dimension. Queries are batched, and both the batches and the paginated
 * responses are accumulated into a single total per instance.
 *
 * Instances which published no observation inside the window come back with a `datapointCount` of 0,
 * which is different from an instance which reported a zero.
 */
export const getInstanceMetricTotals = async ({
    region,
    credentials,
    instanceIds,
    startTime,
    endTime,
    metricName = NETWORK_OUT_METRIC_NAME,
    namespace = EC2_METRIC_NAMESPACE,
    statistic = SUM_STATISTIC,
    period = 300,
}: InstanceMetricTotalsInput): Promise<Record<string, MetricTotal>> => {
    const totals: Record<string, MetricTotal> = {};
    const uniqueInstanceIds = Array.from(new Set((instanceIds || []).filter((instanceId) => !!instanceId)));
    if (!uniqueInstanceIds.length) {
        return totals;
    }
    uniqueInstanceIds.forEach((instanceId) => {
        totals[instanceId] = { total: 0, datapointCount: 0 };
    });

    const cloudWatchClient = new CloudWatchClient({ region, credentials, maxAttempts: 10 });
    try {
        for (let offset = 0; offset < uniqueInstanceIds.length; offset += METRIC_DATA_QUERY_BATCH_SIZE) {
            const batch = uniqueInstanceIds.slice(offset, offset + METRIC_DATA_QUERY_BATCH_SIZE);
            const queryIdToInstanceId: Record<string, string> = {};
            const metricDataQueries: Array<MetricDataQuery> = batch.map((instanceId, index) => {
                // A GetMetricData query id must start with a lower case letter and can only hold
                // letters, digits and underscores, so an instance id cannot be used as one.
                const queryId = `m${index}`;
                queryIdToInstanceId[queryId] = instanceId;
                return {
                    Id: queryId,
                    ReturnData: true,
                    MetricStat: {
                        Metric: {
                            Namespace: namespace,
                            MetricName: metricName,
                            Dimensions: [{ Name: INSTANCE_ID_DIMENSION, Value: instanceId }],
                        },
                        Period: period,
                        Stat: statistic,
                    },
                };
            });

            let nextToken: string | undefined;
            let previousToken: string | undefined;
            do {
                const response = await cloudWatchClient.send(
                    new GetMetricDataCommand({
                        MetricDataQueries: metricDataQueries,
                        StartTime: startTime,
                        EndTime: endTime,
                        NextToken: nextToken,
                    }),
                );
                (response?.MetricDataResults || []).forEach((metricDataResult) => {
                    const instanceId = queryIdToInstanceId[metricDataResult?.Id];
                    if (!instanceId) {
                        return;
                    }
                    const values = metricDataResult?.Values || [];
                    const accumulator = totals[instanceId];
                    accumulator.datapointCount += values.length;
                    accumulator.total += values.reduce(
                        (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) ? value : 0),
                        0,
                    );
                });
                previousToken = nextToken;
                nextToken = response?.NextToken;
                // Guard against a service which keeps handing back the same page token
                if (nextToken && nextToken === previousToken) {
                    nextToken = undefined;
                }
            } while (nextToken);
        }
    } catch (err) {
        if (err?.Code === 'AccessDenied' || err?.name === 'AccessDenied' || err?.name === 'AccessDeniedException') {
            throw new BadRequestException('Invalid IAM role or external ID');
        }
        throw err;
    }

    return totals;
};
