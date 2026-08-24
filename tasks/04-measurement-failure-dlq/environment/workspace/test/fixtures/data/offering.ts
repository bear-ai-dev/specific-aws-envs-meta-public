import { OfferingInfluxRow } from '../../../src/influx/entities/offeringInfluxTable.entity';
import { SupportedOfferingCurrencyEnum } from '../../../src/offering/dto/SupportedCurrencies';
import { ValidBillingCycles } from '../../../src/offering/dto/createOffering.dto';
import { OfferingType } from '../../../src/offering/entities/OfferingType';
import { OfferingPackageEntity } from '../../../src/offering/entities/offeringPackage.entity';
import { productionBusinessID } from './user';

export const offeringDBModelGenerator = (offeringId: string, dimensionId: string): OfferingInfluxRow => ({
    offeringId,
    offeringType: OfferingType.usageBased,
    businessID: productionBusinessID,
    [`dimensionId_${dimensionId}`]: dimensionId,
    billingCycle: ValidBillingCycles.monthly,
    currency: SupportedOfferingCurrencyEnum.USD,
    _field: 'offeringName',
    _value: 'testOffering',
    _measurement: OfferingPackageEntity._measurement,
    _time: '2021-05-28T20:00:00.000Z',
});
