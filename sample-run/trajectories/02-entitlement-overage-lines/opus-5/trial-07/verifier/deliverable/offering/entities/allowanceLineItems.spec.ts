import { Offering } from './offeringPackage.entity.js';
import { InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { OfferingType } from './OfferingType.js';
import { ValidBillingCycles } from '../dto/createOffering.dto.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';

const dim = (over: any) => ({
    dimensionId: over.dimensionId,
    dimensionName: over.dimensionId,
    usageIncrement: over.usageIncrement ?? '1',
    consumptionUnit: { type: 'count', unit: 'count-based' },
    ...over,
});

const run = async (dimensions: any[], usage: Record<string, string>, freeMode: FreeDimensionOnInvoice) => {
    const offering: any = {
        offeringId: 'off',
        offeringName: 'Plan',
        offeringType: OfferingType.usageBased,
        billingCycle: ValidBillingCycles.monthly,
        dimensions,
    };
    const usageOverrides = Object.keys(usage).map((dimensionId) => ({
        offeringId: 'off',
        dimensionId,
        usage: [{ value: usage[dimensionId], startTime: '2026-07-01T00:00:00Z', endTime: '2026-07-02T00:00:00Z' }],
    }));
    const instance = Offering.getInstance(
        offering,
        'cus',
        'biz',
        undefined,
        { freeDimensionOnInvoice: freeMode } as ReadSettingsResponseData,
        undefined,
        undefined,
        undefined,
        usageOverrides as any,
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
        dimensions,
        offeringInstance: instance,
    });
    return lineItems.getLineItems();
};

describe('allowance edge cases', () => {
    test('inf allowance, unexhausted, exact, forbidden, missing overage', async () => {
        const dims = [
            dim({ dimensionId: 'inf', consumptionPrice: '1', usageEntitlement: 'inf', overageAllowed: 'true' }),
            dim({ dimensionId: 'under', consumptionPrice: '1', usageEntitlement: 100, overageAllowed: 'true' }),
            dim({ dimensionId: 'exact', consumptionPrice: '1', usageEntitlement: 50, overageAllowed: 'true' }),
            dim({ dimensionId: 'over', consumptionPrice: '2', usageEntitlement: 50, overageAllowed: 'true' }),
            dim({ dimensionId: 'forbidden', consumptionPrice: '2', usageEntitlement: 10, overageAllowed: 'false' }),
            dim({ dimensionId: 'silent', consumptionPrice: '2', usageEntitlement: 10 }),
            dim({ dimensionId: 'noallowance', consumptionPrice: '3' }),
        ];
        const lines = await run(
            dims,
            { inf: '80', under: '20', exact: '50', over: '75', forbidden: '30', silent: '30', noallowance: '9' },
            FreeDimensionOnInvoice.show,
        );
        expect(lines).toEqual([
            { name: 'over - Plan', quantity: 25, unitCost: 2, description: undefined },
            { name: 'noallowance - Plan', quantity: 9, unitCost: 3, description: undefined },
        ]);
    });

    test('zero priced dimensions honour the invoice setting and report owed quantity', async () => {
        const dims = [
            dim({ dimensionId: 'free', consumptionPrice: '0.00' }),
            dim({ dimensionId: 'freeAllowance', consumptionPrice: '0', usageEntitlement: 10, overageAllowed: 'true' }),
            dim({ dimensionId: 'allowanceOnly', usageEntitlement: 10 }),
        ];
        const shown = await run(
            dims,
            { free: '7', freeAllowance: '25', allowanceOnly: '3' },
            FreeDimensionOnInvoice.show,
        );
        expect(shown).toEqual([
            { name: 'free - Plan', quantity: 7, unitCost: 0, description: undefined },
            { name: 'freeAllowance - Plan', quantity: 15, unitCost: 0, description: undefined },
            { name: 'allowanceOnly - Plan', quantity: 0, unitCost: 0, description: undefined },
        ]);
        const hidden = await run(
            dims,
            { free: '7', freeAllowance: '25', allowanceOnly: '3' },
            FreeDimensionOnInvoice.hide,
        );
        expect(hidden).toEqual([]);
    });

    test('usage increment applies to the owed quantity', async () => {
        const dims = [
            dim({
                dimensionId: 'inc',
                consumptionPrice: '1',
                usageEntitlement: 1000,
                overageAllowed: 'true',
                usageIncrement: '1000',
            }),
        ];
        const lines = await run(dims, { inc: '3000' }, FreeDimensionOnInvoice.show);
        expect(lines).toEqual([{ name: 'inc - Thousand - Plan', quantity: 2, unitCost: 1, description: undefined }]);
    });
});
