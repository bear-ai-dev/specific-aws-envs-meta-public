import {
    CloudWatchClient,
    Dimension as CloudWatchDimension,
    GetMetricDataCommand,
    MetricDataQuery,
} from '@aws-sdk/client-cloudwatch';
import { BadRequestException } from '@nestjs/common';

/**
 * The namespace AWS publishes EC2 instance level metrics under
 */
export const EC2_METRIC_NAMESPACE = 'AWS/EC2';

/**
 * The metric holding the number of bytes sent out of an instance on all network interfaces.
 * NetworkIn is the mirror of this metric (bytes received) and is deliberately not used here,
 * outbound traffic is what gets billed.
 */
export const NETWORK_OUT_METRIC_NAME = 'NetworkOut';

/**
 * CloudWatch caps the amount of metric data queries which can travel in a single GetMetricData
 * request, batching keeps the number of API calls proportional to the size of the estate.
 */
const MAX_QUERIES_PER_REQUEST = 100;

export const chunkArray = <T>(items: Array<T>, size: number): Array<Array<T>> => {
    const chunks: Array<Array<T>> = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
};

/**
 * Read one AWS metric for a list of resources and total the observations found inside the window.
 *
 * A series which published nothing inside the window is *absent* from the result, it is not
 * reported as a zero. An idle resource which did publish, publishes zeroes, and those are totaled
 * to zero and present in the result. This mirrors how CloudWatch itself answers.
 *
 * @param region the region the resources live in
 * @param creds credentials for the account owning the resources
 * @param dimensionName the metric dimension identifying a single resource, `InstanceId` for EC2
 * @param resourceIds the resources to read the metric for
 * @param startTime the inclusive start of the window
 * @param endTime the exclusive end of the window
 * @param metricName the metric to read
 * @param namespace the namespace the metric is published under
 * @param period the granularity, in seconds, of the observations
 * @param statistic the statistic used to condense each period, `Sum` totals the observations
 */
export const getMetricTotalsByResource = async ({
    region,
    creds,
    resourceIds,
    dimensionName = 'InstanceId',
    startTime,
    endTime,
    metricName,
    namespace,
    period = 300,
    statistic = 'Sum',
}: {
    region: string;
    creds?: any;
    resourceIds: Array<string>;
    dimensionName?: string;
    startTime: Date;
    endTime: Date;
    metricName: string;
    namespace: string;
    period?: number;
    statistic?: string;
}): Promise<Record<string, number>> => {
    const totals: Record<string, number> = {};
    if (!resourceIds || resourceIds.length === 0) {
        return totals;
    }
    // CloudWatch throttles a caller reading a large fleet, so give the client room to back off
    // and retry rather than losing a whole run to a rate limit.
    const cloudWatchClient = new CloudWatchClient({ region, credentials: creds, maxAttempts: 8 });
    try {
        for (const batch of chunkArray(resourceIds, MAX_QUERIES_PER_REQUEST)) {
            // A metric data query id has to start with a lowercase letter and may only hold
            // letters, digits and underscores, resource ids typically hold characters which are
            // not allowed, so the ids are positional and mapped back afterwards.
            const queryIdToResourceId: Record<string, string> = {};
            const MetricDataQueries: Array<MetricDataQuery> = batch.map((resourceId, index) => {
                const queryId = `q${index}`;
                queryIdToResourceId[queryId] = resourceId;
                const Dimensions: Array<CloudWatchDimension> = [{ Name: dimensionName, Value: resourceId }];
                return {
                    Id: queryId,
                    ReturnData: true,
                    MetricStat: {
                        Metric: { Namespace: namespace, MetricName: metricName, Dimensions },
                        Period: period,
                        Stat: statistic,
                    },
                };
            });
            let nextToken: string;
            do {
                const response = await cloudWatchClient.send(
                    new GetMetricDataCommand({
                        MetricDataQueries,
                        StartTime: startTime,
                        EndTime: endTime,
                        ScanBy: 'TimestampDescending',
                        NextToken: nextToken,
                    }),
                );
                (response?.MetricDataResults || []).forEach(({ Id, Values }) => {
                    const resourceId = queryIdToResourceId[Id];
                    if (!resourceId || !Values || Values.length === 0) {
                        // No observation for this resource in this page, nothing to total.
                        return;
                    }
                    totals[resourceId] = Values.reduce(
                        (total, value) => total + (typeof value === 'number' ? value : 0),
                        totals[resourceId] === undefined ? 0 : totals[resourceId],
                    );
                });
                nextToken = response?.NextToken;
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

/**
 * Total the bytes each instance sent out over the given window, keyed by instance id.
 *
 * Instances which published no NetworkOut observation inside the window are absent from the
 * result rather than present with a zero.
 */
export const getNetworkOutBytesByInstance = async ({
    region,
    creds,
    instanceIds,
    startTime,
    endTime,
    period = 300,
}: {
    region: string;
    creds?: any;
    instanceIds: Array<string>;
    startTime: Date;
    endTime: Date;
    period?: number;
}): Promise<Record<string, number>> =>
    getMetricTotalsByResource({
        region,
        creds,
        resourceIds: instanceIds,
        dimensionName: 'InstanceId',
        startTime,
        endTime,
        metricName: NETWORK_OUT_METRIC_NAME,
        namespace: EC2_METRIC_NAMESPACE,
        period,
        statistic: 'Sum',
    });
