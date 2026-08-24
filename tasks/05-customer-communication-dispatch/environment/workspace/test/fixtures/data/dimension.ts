import { randomUUID } from 'crypto';
import { DimensionEntity } from '../../../src/dimensions/entities/dimensions.entity';
import { productionBusinessID } from './user';
import { roundingEnum } from '../../../src/dimensions/dto/create-dimension.dto';

const dimensionDBModel = {
    _measurement: DimensionEntity._measurement,
    _time: '2022-12-31T23:59:59.999Z',
    _value: 'dimensionName Cool Value',
    _field: 'dimensionName',
    dimensionId: randomUUID(),
    businessID: productionBusinessID,
    dimensionUnit: 'count',
    dimensionUnitType: 'count-based',
    rounding: roundingEnum.ceiling,
    typeofDimension: 'numerical',
    usageIncrement: '10',
    priceSegments: JSON.stringify([
        {
            lowerLimit: '0',
            upperLimit: 'inf',
            price: '20.00',
        },
    ]),
};
export const dimensionDBModelGenerator = (dimensionId?: string) =>
    dimensionId ? { ...dimensionDBModel, dimensionId } : dimensionDBModel;
