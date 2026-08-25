import {
    CostExplorerClient,
    Dimension,
    GetCostAndUsageCommand,
    Granularity,
    GroupDefinitionType,
} from '@aws-sdk/client-cost-explorer';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types/dist-types/identity';
import { getDaysInCurrentMonth } from '../../cost/entities/ebsCost.entity.js';
import { AnalyticsService, CostSourceFunctionInput, MonthlyStorageCost } from '../../analytics/analytics.service.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';

/**
 *
 * @param startDate Inclusive. Must be the 1st day of the month in order for the bill to be complete
 * @param endDate Exclusive. Must be the 1st day of the month after the desired billing period for the bill to be complete
 */
export type MonthlyBillResults = {
    [key: string]: { bill: number; startDate: string; endDate: string };
};

export const getMonthlyBill = async (
    startDate: Date,
    endDate: Date,
    creds: AwsCredentialIdentityProvider,
): Promise<MonthlyBillResults> => {
    const client = new CostExplorerClient({ region: 'us-east-1', credentials: creds });
    const param = {
        Granularity: Granularity.MONTHLY,
        TimePeriod: {
            Start: startDate.toISOString().substring(0, 10),
            End: endDate.toISOString().substring(0, 10),
        },
        Filter: {
            Not: {
                Dimensions: {
                    Key: Dimension.RECORD_TYPE,
                    Values: ['Credit'],
                },
            },
        },
        GroupBy: [
            {
                Type: GroupDefinitionType.DIMENSION,
                Key: 'LINKED_ACCOUNT',
            },
        ],
        Metrics: ['BlendedCost', 'UnblendedCost'],
    };
    const command = new GetCostAndUsageCommand(param);
    const resultByTimes = (await client.send(command)).ResultsByTime;
    const response = {};
    await Promise.all(
        resultByTimes.map(async (monthlyResults) => {
            const { Start: startDate, End: endDate } = monthlyResults.TimePeriod;
            let monthlyBill = 0;

            const currencyExchangeRateMap = await monthlyResults.Groups.reduce(async (acc, item) => {
                await acc;
                const currency = item.Metrics.BlendedCost.Unit;
                if (currency && currency !== SupportedCurrencies.USD) {
                    if (acc[currency]) {
                        return acc;
                    } else {
                        const exchangeRate = await AnalyticsService.getExchangeRate({ currency });

                        return (acc[currency] = exchangeRate);
                    }
                }
                return acc;
            }, Promise.resolve({}));
            monthlyResults.Groups.forEach((entry) => {
                const currency = entry.Metrics.BlendedCost.Unit;
                if (currency && currency !== SupportedCurrencies.USD) {
                    monthlyBill += Number(entry.Metrics.BlendedCost.Amount) * currencyExchangeRateMap[currency];
                } else {
                    monthlyBill += Number(entry.Metrics.BlendedCost.Amount);
                }
            });
            response[startDate] = {
                bill: monthlyBill,
                startDate,
                endDate,
            };
        }),
    );
    return response;
};

/**
 * Builds filter parameters for cost explorer depending on whether serviceIds and applicationIds are provided
 * Assumes that if they are empty / not provided that the caller wants to see all resources IE: not perCustomer
 */

const tagFilterBuilder = ({ customerIds }: { customerIds?: string[] }) => {
    if (customerIds?.length) {
        return {
            Tags: {
                Key: 'meteringcoCustomerId',
                Values: customerIds,
            },
        };
    } else {
        return {
            Not: {
                Tags: {
                    Key: 'meteringcoCustomerId',
                    Values: [''],
                },
            },
        };
    }
};

/**
 *
 * @param startDate
 * @param endDate
 * @return
 * {
 *     "2023-01-01": {
 *         "cost": {
 *             "ebsVolume": 0.709677408,
 *             "ebsSnapshot": 0
 *         },
 *         "startDate": "2023-01-01",
 *         "endDate": "2023-02-01"
 *     }
 * }
 */
export const getMonthlyCostOfVolumeAndSnapshot = async ({
    startDate,
    endDate,
    creds,
    customerIds,
}: CostSourceFunctionInput): Promise<MonthlyStorageCost> => {
    const client = new CostExplorerClient({ region: 'us-east-1', credentials: creds });
    const param = {
        Granularity: Granularity.MONTHLY,
        Filter: {
            And: [
                {
                    Not: {
                        Dimensions: {
                            Key: Dimension.RECORD_TYPE,
                            Values: ['Credit'],
                        },
                    },
                },
                tagFilterBuilder({ customerIds }),
                {
                    Dimensions: {
                        Key: Dimension.USAGE_TYPE_GROUP,
                        Values: ['EC2: EBS - SSD(gp3)', 'EC2: EBS - SSD(gp2)', 'EC2: EBS - Snapshots'],
                    },
                },
            ],
        },
        TimePeriod: {
            Start: startDate.toISOString().substring(0, 10),
            End: endDate.toISOString().substring(0, 10),
        },
        GroupBy: [
            {
                Type: GroupDefinitionType.DIMENSION,
                Key: 'USAGE_TYPE',
            },
        ],
        Metrics: ['BlendedCost'],
    };
    const command = new GetCostAndUsageCommand(param);
    const rawResults = await client.send(command);
    const resultsByTime = rawResults.ResultsByTime;
    const response = {};
    await Promise.all(
        resultsByTime.map(async (monthlyResults) => {
            const { Start: startDate, End: endDate } = monthlyResults.TimePeriod;

            let monthlyVolumeCost = 0;
            let monthlySnapshotCost = 0;

            const currencyExchangeRateMap = await monthlyResults.Groups.reduce(async (acc, item) => {
                const resolvedAcc = await acc;
                const currency = item.Metrics.BlendedCost.Unit;
                if (currency && currency !== SupportedCurrencies.USD) {
                    if (resolvedAcc[currency]) {
                        return resolvedAcc;
                    } else {
                        const exchangeRate = await AnalyticsService.getExchangeRate({ currency });

                        return (resolvedAcc[currency] = exchangeRate);
                    }
                }
                return resolvedAcc;
            }, Promise.resolve({}));
            monthlyResults.Groups.forEach((entry) => {
                const key = entry.Keys[0];
                const currency = entry.Metrics.BlendedCost.Unit;
                if (key.includes('Snapshot')) {
                    if (currency && currency !== SupportedCurrencies.USD) {
                        monthlySnapshotCost +=
                            Number(entry.Metrics.BlendedCost.Amount) * currencyExchangeRateMap[currency];
                    } else {
                        monthlySnapshotCost += Number(entry.Metrics.BlendedCost.Amount);
                    }
                } else if (key.includes('Volume')) {
                    if (currency && currency !== SupportedCurrencies.USD) {
                        monthlyVolumeCost +=
                            Number(entry.Metrics.BlendedCost.Amount) * currencyExchangeRateMap[currency];
                    } else {
                        monthlyVolumeCost += Number(entry.Metrics.BlendedCost.Amount);
                    }
                }
            });
            response[startDate] = {
                cost: {
                    ebsVolume: monthlyVolumeCost,
                    ebsSnapshot: monthlySnapshotCost,
                },
                startDate,
                endDate,
            };
        }),
    );
    return response;
};

export class CostResponse {
    startDate: string;
    endDate: string;
    cost: number;
    quantity: number;
    rate: number;
    rateUnit: string;
}
export const getSnapshotCost = async (
    creds: AwsCredentialIdentityProvider,
    startDate: Date,
    endDate: Date,
): Promise<CostResponse[]> => {
    const client = new CostExplorerClient({ region: 'us-east-1', credentials: creds });
    const param = {
        Granularity: Granularity.HOURLY,
        Filter: {
            And: [
                {
                    Not: {
                        Dimensions: {
                            Key: Dimension.RECORD_TYPE,
                            Values: ['Credit'],
                        },
                    },
                },
                {
                    Dimensions: {
                        Key: Dimension.USAGE_TYPE_GROUP,
                        Values: ['EC2: EBS - Snapshots'],
                    },
                },
                {
                    Or: [
                        {
                            Not: {
                                Tags: {
                                    Key: 'meteringcoApplicationId',
                                    Values: [''],
                                },
                            },
                        },
                        {
                            Not: {
                                Tags: {
                                    Key: 'meteringcoServiceId',
                                    Values: [''],
                                },
                            },
                        },
                    ],
                },
            ],
        },
        TimePeriod: {
            Start: startDate.toISOString().substring(0, 19) + 'Z',
            End: endDate.toISOString().substring(0, 19) + 'Z',
        },
        GroupBy: [
            {
                Type: GroupDefinitionType.DIMENSION,
                Key: 'USAGE_TYPE',
            },
        ],
        Metrics: ['BlendedCost', 'USAGE_QUANTITY'],
    };
    const command = new GetCostAndUsageCommand(param);
    const { ResultsByTime: resultsByTime } = await client.send(command);
    const response = resultsByTime.map((hourlyResult): CostResponse => {
        const { Start: startDate, End: endDate } = hourlyResult.TimePeriod;
        const { cost, quantity, rate, rateUnit } = hourlyResult.Groups.reduce(
            (acc, { Keys: [element], Metrics }) => {
                if (element.includes('Snapshot')) {
                    acc['cost'] += Number(Metrics.BlendedCost.Amount) / (getDaysInCurrentMonth() * 24);
                    acc['quantity'] += Number(Metrics.UsageQuantity.Amount) / (getDaysInCurrentMonth() * 24);
                    if (acc['quantity'] !== 0) {
                        acc['rate'] = acc['cost'] / acc['quantity'];
                    } else {
                        acc['rate'] = 0;
                    }
                }
                return acc;
            },
            { cost: 0, quantity: 0, rate: 0, rateUnit: 'USD/GB-Hour' },
        );

        return {
            quantity,
            cost,
            rate,
            startDate,
            endDate,
            rateUnit,
        };
    }, {});
    return response;
};
