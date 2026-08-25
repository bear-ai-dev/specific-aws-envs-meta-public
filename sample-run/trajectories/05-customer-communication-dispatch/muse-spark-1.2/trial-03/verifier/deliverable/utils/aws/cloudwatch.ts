import { BadRequestException } from '@nestjs/common';
import { CloudWatchClient, GetMetricDataCommand } from '@aws-sdk/client-cloudwatch';

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
