import { BadRequestException } from '@nestjs/common';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

export type MetricReading = {
    timestamp: string;
    value: number;
};

/**
 * The readings a single series published over a window, oldest first. The
 * caller names the series by its whole dimension set, which is how the metric
 * store keys them.
 */
export const getMetricSeries = async ({
    namespace,
    metricName,
    dimensions,
    startTime,
    endTime,
    period,
}: {
    namespace: string;
    metricName: string;
    dimensions: Record<string, string>;
    startTime: Date;
    endTime: Date;
    period: number;
}): Promise<MetricReading[]> => {
    const cloudwatchClient = new CloudWatchClient({});
    const readings: MetricReading[] = [];
    let NextToken: string | undefined;
    do {
        const response = await cloudwatchClient.send(
            new GetMetricDataCommand({
                StartTime: startTime,
                EndTime: endTime,
                ScanBy: 'TimestampAscending',
                NextToken,
                MetricDataQueries: [
                    {
                        Id: 'series',
                        ReturnData: true,
                        MetricStat: {
                            Metric: {
                                Namespace: namespace,
                                MetricName: metricName,
                                Dimensions: Object.keys(dimensions).map((Name) => ({
                                    Name,
                                    Value: dimensions[Name],
                                })),
                            },
                            Period: period,
                            Stat: 'Sum',
                        },
                    },
                ],
            }),
        );
        (response?.MetricDataResults ?? []).forEach((metricDataResult) => {
            const values = metricDataResult?.Values ?? [];
            (metricDataResult?.Timestamps ?? []).forEach((timestamp, index) => {
                readings.push({
                    timestamp: new Date(timestamp).toISOString(),
                    value: Number(values[index] ?? 0),
                });
            });
        });
        NextToken = response?.NextToken;
    } while (NextToken);
    return readings.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
};

export const getEc2Egress = async (region, creds, startTime, endTime, instanceIds: string[]): Promise<any> => {
    if (instanceIds.length === 0) {
        return [];
    }
    try {
        const cloudwatchClient = new CloudWatchClient({ region, credentials: creds });
        let res = [];
        for (const instanceId of instanceIds) {
            const MetricDataQueries = [instanceId].map((instanceId) => {
                return {
                    Id: 'i' + instanceId.substring(2),
                    Period: 300,
                    Expression: `SELECT SUM(NetworkOut) FROM SCHEMA("AWS/EC2", InstanceId) WHERE InstanceId = '${instanceId}'`,
                };
            });
            const params = {
                StartTime: startTime,
                EndTime: endTime,
                MetricDataQueries,
            };
            let next;
            do {
                const response = await cloudwatchClient.send(new GetMetricDataCommand(params));
                const { MetricDataResults } = response;
                MetricDataResults.forEach((metricDataResult) => {
                    metricDataResult.Id = 'i-' + metricDataResult.Id.substring(1);
                });
                next = response?.NextToken;
                res = res.concat(MetricDataResults);
            } while (next);
        }
        return res;
    } catch (err) {
        console.log('Error', err);
        if (err.Code === 'AccessDenied') {
            throw new BadRequestException(`Invalid IAM role or external ID`);
        } else {
            throw new BadRequestException(`'Error fetching cloudwatch metrics`);
        }
    }
};
