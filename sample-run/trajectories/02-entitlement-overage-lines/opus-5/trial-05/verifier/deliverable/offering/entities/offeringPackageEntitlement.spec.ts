import { Offering } from './offeringPackage.entity.js';
import { InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';
import { OfferingType } from './OfferingType.js';
import { ValidBillingCycles } from '../dto/createOffering.dto.js';
import { SupportedCurrencies } from '../dto/SupportedCurrencies.js';
import {
    aggregationInterval,
    aggregationMethod,
    countBasedUnits,
    roundingEnum,
    overageAllowedEnum,
} from '../../dimensions/dto/create-dimension.dto.js';

const dim = (over: any) => ({
    aggregationInterval: aggregationInterval.month,
    aggregationMethod: aggregationMethod.sum,
    dimensionName: 'D',
    rounding: roundingEnum.floor,
    consumptionUnit: { unit: countBasedUnits['count-based'], type: 'count' },
    dimensionId: '123',
    usageIncrement: '1',
    ...over,
});

const run = async (dimension, settings?: ReadSettingsResponseData, usageValue = '25') => {
    const offeringConfig = {
        offeringId: '1',
        offeringName: 'Plan',
        offeringType: OfferingType.usageBased,
        currency: SupportedCurrencies.USD,
        dimensions: [dimension],
        billingCycle: ValidBillingCycles.monthly,
    } as any;
    const instance = Offering.getInstance(
        offeringConfig,
        'cus',
        'biz',
        undefined,
        settings,
        undefined,
        undefined,
        undefined,
        [
            {
                offeringId: '1',
                dimensionId: '123',
                usage: [{ value: usageValue, startTime: '2026-07-02T00:00:00Z', endTime: '2026-07-02T00:00:00Z' }],
            },
        ] as any,
    );
    const lineItems = new InvoiceLineItems();
    await Offering.getLineItemsForUsage({
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-08-01T00:00:00Z'),
        lineItems,
        negative: false,
        businessID: 'biz',
        customerId: 'cus',
        customerService: undefined,
        dimensions: [dimension],
        offeringInstance: instance,
    });
    return lineItems.getLineItems();
};

describe('Offering allowances and free dimensions', () => {
    test('free dimension with exhausted allowance reports owed quantity', async () => {
        expect(
            await run(dim({ consumptionPrice: '0', usageEntitlement: 10, overageAllowed: overageAllowedEnum.true }), {
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            } as any),
        ).toEqual([expect.objectContaining({ quantity: 15, unitCost: 0 })]);
    });
    test('free dimension with unlimited allowance reports zero when shown', async () => {
        expect(
            await run(
                dim({ consumptionPrice: '0', usageEntitlement: 'inf', overageAllowed: overageAllowedEnum.true }),
                { freeDimensionOnInvoice: FreeDimensionOnInvoice.show } as any,
            ),
        ).toEqual([expect.objectContaining({ quantity: 0, unitCost: 0 })]);
    });
    test('free dimension hidden', async () => {
        expect(
            await run(dim({ consumptionPrice: '0' }), { freeDimensionOnInvoice: FreeDimensionOnInvoice.hide } as any),
        ).toEqual([]);
    });
    test('free dimension shown when settings absent', async () => {
        expect(await run(dim({ consumptionPrice: '0' }), undefined)).toEqual([
            expect.objectContaining({ quantity: 25, unitCost: 0 }),
        ]);
    });
    test('zero allowance with overage allowed charges everything', async () => {
        expect(
            await run(dim({ consumptionPrice: '2', usageEntitlement: 0, overageAllowed: overageAllowedEnum.true })),
        ).toEqual([expect.objectContaining({ quantity: 25, unitCost: 2 })]);
    });
    test('allowance only dimension without a price is not charged and is not NaN', async () => {
        const lines = await run(dim({ usageEntitlement: 10, overageAllowed: overageAllowedEnum.false }), {
            freeDimensionOnInvoice: FreeDimensionOnInvoice.hide,
        } as any);
        expect(lines).toEqual([]);
        const shown = await run(dim({ usageEntitlement: 10, overageAllowed: overageAllowedEnum.false }), {
            freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
        } as any);
        expect(shown).toEqual([expect.objectContaining({ quantity: 0, unitCost: 0 })]);
    });
    test('priced dimension with no usage gets no line', async () => {
        expect(await run(dim({ consumptionPrice: '2' }), undefined, '0')).toEqual([]);
    });
    test('usage increment applies to owed quantity', async () => {
        expect(
            await run(
                dim({
                    consumptionPrice: '2',
                    usageIncrement: '5',
                    usageEntitlement: 10,
                    overageAllowed: overageAllowedEnum.true,
                }),
            ),
        ).toEqual([expect.objectContaining({ quantity: 3, unitCost: 2 })]);
    });
    test('boolean-ish overage flags are honoured', async () => {
        expect(await run(dim({ consumptionPrice: '2', usageEntitlement: 10, overageAllowed: true as any }))).toEqual([
            expect.objectContaining({ quantity: 15 }),
        ]);
        expect(await run(dim({ consumptionPrice: '2', usageEntitlement: 10 }))).toEqual([]);
    });
});
