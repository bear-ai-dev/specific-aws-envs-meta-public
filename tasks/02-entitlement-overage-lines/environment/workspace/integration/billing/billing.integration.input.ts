import { AggregationMethod, OverageAllowed } from '../client/publicClient/dimension.js';

export const BILLING_AGGREGATION_INPUT = [
    [
        [
            {
                aggregationMethod: AggregationMethod.Sum,
                usageInput: ['0', '2'],
                aggregatedValue: '2',
                unitName: undefined,
                usageIncrement: '1',
            },
        ],
    ],
    [
        [
            {
                aggregationMethod: AggregationMethod.Sum,
                usageInput: ['0', '1000'],
                aggregatedValue: '1',
                unitName: 'Thousand',
                usageIncrement: '1000',
            },
        ],
    ],
    [
        [
            {
                aggregationMethod: AggregationMethod.Sum,
                usageInput: ['1', '2'],
                aggregatedValue: '3',
            },
            {
                aggregationMethod: AggregationMethod.Sum,
                usageInput: ['0', '0'],
                aggregatedValue: '0',
            },
            {
                aggregationMethod: AggregationMethod.Count,
                usageInput: ['1', '2'],
                aggregatedValue: '2',
            },
        ],
    ],
    [
        [
            {
                aggregationMethod: AggregationMethod.Sum,
                usageInput: ['10000000000', '20000000000'],
                aggregatedValue: '30000000000',
            },
            {
                aggregationMethod: AggregationMethod.Average,
                usageInput: ['1', '2'],
                aggregatedValue: '2',
            }, // Default rounding is ceiling
        ],
    ],
    [
        [
            {
                aggregationMethod: AggregationMethod.Min,
                usageInput: ['1000000', '2000000'],
                aggregatedValue: '1000000',
            },
            {
                aggregationMethod: AggregationMethod.Min,
                usageInput: ['10000000000', '20000000000'],
                aggregatedValue: '10000000000',
            },
            {
                aggregationMethod: AggregationMethod.Max,
                usageInput: ['1', '2'],
                aggregatedValue: '2',
            },
        ],
    ],
    [
        [
            {
                aggregationMethod: AggregationMethod.Sum,
                usageInput: ['10000000000', '20000000000'],
                aggregatedValue: '30000000000',
            },
            {
                aggregationMethod: AggregationMethod.Average,
                usageInput: ['1', '2'],
                aggregatedValue: '2',
            }, // Default rounding is ceiling
            {
                aggregationMethod: AggregationMethod.Min,
                usageInput: ['1000000', '2000000'],
                aggregatedValue: '1000000',
            },
            {
                aggregationMethod: AggregationMethod.Min,
                usageInput: ['10000000000', '20000000000'],
                aggregatedValue: '10000000000',
            },
            {
                aggregationMethod: AggregationMethod.Max,
                usageInput: ['1', '2'],
                aggregatedValue: '2',
            },
            {
                aggregationMethod: AggregationMethod.Sum,
                usageInput: ['0', '0'],
                aggregatedValue: '0',
                usageIncrement: '1',
                unitName: undefined,
            },
        ],
    ],
];
