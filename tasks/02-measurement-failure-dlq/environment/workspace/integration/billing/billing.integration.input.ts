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

export const BILLING_ENTITLEMENTS_INPUT = [
    [
        {
            testName: 'test 1',
            dimensions: [
                {
                    dimensionName: 'dimension1',
                    usageEntitlement: 10,
                    allowOverage: OverageAllowed.False,
                    aggregationMethod: AggregationMethod.Sum,
                    usageInput: ['0', '2'],
                    aggregatedValue: '2',
                    consumptionPrice: undefined,
                },
            ],
            invoiceExpecations: {
                numberOfLineItems: 0,
                lineItems: [],
            },
        },
    ],
    [
        {
            testName: 'test 2',
            dimensions: [
                {
                    dimensionName: 'dimension1',
                    usageEntitlement: 10,
                    allowOverage: OverageAllowed.False,
                    aggregationMethod: AggregationMethod.Sum,
                    usageInput: ['0', '2'],
                    aggregatedValue: '2',
                    consumptionPrice: undefined,
                },
                {
                    dimensionName: 'dimension2',
                    usageEntitlement: 100,
                    allowOverage: OverageAllowed.True,
                    aggregationMethod: AggregationMethod.Sum,
                    usageInput: ['0', '2', '100'],
                    aggregatedValue: '102',
                    consumptionPrice: '0.01',
                },
            ],
            invoiceExpecations: {
                numberOfLineItems: 1,
                lineItems: [{ dimensionName: 'dimension2', quantity: 2 }],
            },
        },
    ],
    [
        {
            testName: 'test 3',
            dimensions: [
                {
                    dimensionName: 'dimension1',
                    usageEntitlement: 10,
                    allowOverage: OverageAllowed.True,
                    aggregationMethod: AggregationMethod.Count,
                    usageInput: ['0', '2'],
                    aggregatedValue: '2',
                    consumptionPrice: '0.1',
                },
                {
                    dimensionName: 'dimension2',
                    usageEntitlement: 1000,
                    allowOverage: OverageAllowed.True,
                    aggregationMethod: AggregationMethod.Max,
                    usageInput: ['0', '2', '100'],
                    aggregatedValue: '100',
                    consumptionPrice: '0.2',
                },
            ],
            invoiceExpecations: {
                numberOfLineItems: 2,
                lineItems: [
                    { dimensionName: 'dimension1', quantity: 0 },
                    { dimensionName: 'dimension2', quantity: 0 },
                ],
            },
        },
    ],
    [
        {
            testName: 'test 4',
            dimensions: [
                {
                    dimensionName: 'dimension1',
                    usageEntitlement: 10,
                    allowOverage: OverageAllowed.False,
                    aggregationMethod: AggregationMethod.Sum,
                    usageInput: ['0', '2'],
                    aggregatedValue: '2',
                    consumptionPrice: undefined,
                },
                {
                    dimensionName: 'dimension2',
                    usageEntitlement: 1000,
                    allowOverage: OverageAllowed.False,
                    aggregationMethod: AggregationMethod.Max,
                    usageInput: ['0', '2', '100'],
                    aggregatedValue: '100',
                    consumptionPrice: undefined,
                },

                {
                    dimensionName: 'dimension3',
                    usageEntitlement: 1000,
                    allowOverage: OverageAllowed.False,
                    aggregationMethod: AggregationMethod.Max,
                    usageInput: ['0', '2', '100'],
                    aggregatedValue: '100',
                    consumptionPrice: undefined,
                },
            ],
            invoiceExpecations: {
                numberOfLineItems: 0,
                lineItems: [],
            },
        },
    ],
    [
        {
            testName: 'test 5',
            dimensions: [
                {
                    dimensionName: 'dimension1',
                    usageEntitlement: 10,
                    allowOverage: OverageAllowed.True,
                    aggregationMethod: AggregationMethod.Sum,
                    usageInput: ['0', '50', '100'],
                    aggregatedValue: '150',
                    consumptionPrice: '2',
                },
                {
                    dimensionName: 'dimension2',
                    usageEntitlement: 1000,
                    allowOverage: OverageAllowed.True,
                    aggregationMethod: AggregationMethod.Max,
                    usageInput: ['0', '2', '2000'],
                    aggregatedValue: '2000',
                    consumptionPrice: '2.31',
                },
            ],
            invoiceExpecations: {
                numberOfLineItems: 2,
                lineItems: [
                    { dimensionName: 'dimension1', quantity: 140 },
                    { dimensionName: 'dimension2', quantity: 1000 },
                ],
            },
        },
    ],
];
