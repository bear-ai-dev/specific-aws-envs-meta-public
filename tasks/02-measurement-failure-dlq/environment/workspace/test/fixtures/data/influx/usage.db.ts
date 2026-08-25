import { UsageRow } from '../../../../src/influx/entities/usageRow.entity';
import { CreateUsageDto } from '../../../../src/usage/dto/create-usage.dto';
import { UsageEntity } from '../../../../src/usage/entities/usage.entity';

import { productionBusinessID } from '../user';

const usageRow: UsageRow = {
    _measurement: UsageEntity._measurement,
    _time: '2022-12-31T23:59:59.999Z',
    _value: 10,
    _field: 'dimensionName',
    dimensionId: 'dimensionId',
    businessID: productionBusinessID,
    customerId: 'customerId',
};

/**
 * A simple generator for usage rows, given the standard usage dto that the API uses.
 */
export const usageRowGenerator = ({
    dimensionId,
    customerId,
    recordValue,
    timestamp,
    metadata,
    businessID,
}: Partial<CreateUsageDto>) => {
    let metadataObject: Record<string, string | number | null> = {};
    if (metadata) {
        metadataObject = Object.keys(metadata).reduce((acc, key) => {
            acc[`metadata_${key}`] = JSON.stringify(metadata[key]);
            return acc;
        }, {});
    }
    return {
        ...usageRow,
        ...metadataObject,
        dimensionId: dimensionId || usageRow.dimensionId,
        customerId: customerId || usageRow.customerId,
        _value: recordValue ? Number(recordValue) : usageRow._value,
        _time: timestamp || usageRow._time,
        businessID: businessID || usageRow.businessID,
    };
};
