import {
    AggregatedUsageResponse,
    MetadataGroupedAggregatedUsageResponse,
    UsageResponseDocument,
} from '../../../src/customer/dto/read-customer.dto.js';

export const aggregatedUsages: AggregatedUsageResponse[] = [
    {
        dimensionId: '8a7b5f91-3b85-4cf4-8585-dcdf17f49004',
        usage: [
            {
                startTime: '2023-08-01T00:00:00Z',
                endTime: '2023-08-01T23:59:59Z',
                value: '123.45',
            },
            {
                startTime: '2023-08-02T00:00:00Z',
                endTime: '2023-08-02T23:59:59Z',
                value: '321.54',
            },
        ],
    },
];

export const aggregateUsageGenerator = (dimensionId: string, offeringId: string): AggregatedUsageResponse => ({
    offeringId,
    dimensionId,
    usage: [
        {
            startTime: '2023-08-01T00:00:00Z',
            endTime: '2023-08-01T23:59:59Z',
            value: '123.45',
        },
        {
            startTime: '2023-08-02T00:00:00Z',
            endTime: '2023-08-02T23:59:59Z',
            value: '321.54',
        },
    ],
});

export const groupedMetadataUsageGenerator = (
    dimensionId: string,
    offeringId: string,
    metadata: Record<string, string>,
    usage?: UsageResponseDocument[],
): MetadataGroupedAggregatedUsageResponse => ({
    dimensionId,
    offeringId,
    metadataGroup: metadata,
    usage:
        usage && usage?.length
            ? usage
            : [
                  {
                      startTime: '2023-08-01T00:00:00Z',
                      endTime: '2023-08-01T23:59:59Z',
                      value: '123.45',
                  },
                  {
                      startTime: '2023-08-02T00:00:00Z',
                      endTime: '2023-08-02T23:59:59Z',
                      value: '321.54',
                  },
              ],
});
