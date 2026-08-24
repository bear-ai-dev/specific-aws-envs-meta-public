import { Offering } from './offeringPackage.entity.js';
import { InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { OfferingType } from './OfferingType.js';
import { ValidBillingCycles } from '../dto/createOffering.dto.js';
import { SupportedCurrencies } from '../dto/SupportedCurrencies.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';

const dim = (over: any) => ({
    dimensionId: over.dimensionId,
    dimensionName: over.dimensionId,
    aggregationInterval: 'hour',
    aggregationMethod: 'sum',
    usageIncrement: '1',
    consumptionUnit: { unit: 'count-based', type: 'count' },
    rounding: 'round',
    ...over,
});

const run = async (
    dimensions: any[],
    usage: any[],
    freeDimensionOnInvoice: FreeDimensionOnInvoice,
    negative = false,
) => {
    const offeringConfig: any = {
        offeringId: 'o1',
        offeringName: 'Plan',
        offeringType: OfferingType.usageBased,
        currency: SupportedCurrencies.USD,
        billingCycle: ValidBillingCycles.monthly,
        dimensions,
    };
    const instance = Offering.getInstance(
        offeringConfig,
        'c1',
        'b1',
        undefined,
        { freeDimensionOnInvoice } as any,
        undefined,
        undefined,
        undefined,
        usage as any,
    );
    const lineItems = new InvoiceLineItems();
    await Offering.getLineItemsForUsage({
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-08-01T00:00:00Z'),
        lineItems,
        negative,
        businessID: 'b1',
        customerId: 'c1',
        customerService: undefined,
        dimensions,
        offeringInstance: instance,
    });
    return lineItems.getLineItems();
};

const usageFor = (dimensionId: string, values: string[]) => ({
    offeringId: 'o1',
    dimensionId,
    usage: values.map((value) => ({ value, startTime: '2026-07-01T00:00:00Z', endTime: '2026-07-01T01:00:00Z' })),
});

describe('allowance and free dimension edge cases', () => {
    it('hides free dimensions when settings say hide, even with usage', async () => {
        const dims = [dim({ dimensionId: 'free', consumptionPrice: '0.00' })];
        expect(await run(dims, [usageFor('free', ['9'])], FreeDimensionOnInvoice.hide)).toEqual([]);
        expect(await run(dims, [usageFor('free', ['9'])], FreeDimensionOnInvoice.show)).toEqual([
            expect.objectContaining({ name: 'free - Plan', quantity: 9, unitCost: 0 }),
        ]);
    });
    it('defaults to showing free dimensions when the setting is absent', async () => {
        const dims = [dim({ dimensionId: 'free', consumptionPrice: '0' })];
        expect(await run(dims, [usageFor('free', ['4'])], undefined)).toEqual([
            expect.objectContaining({ name: 'free - Plan', quantity: 4, unitCost: 0 }),
        ]);
    });
    it('free dimension line reports only the quantity owed under an allowance', async () => {
        const dims = [
            dim({ dimensionId: 'free', consumptionPrice: '0.00', usageEntitlement: 5, overageAllowed: 'true' }),
        ];
        expect(await run(dims, [usageFor('free', ['8'])], FreeDimensionOnInvoice.show)).toEqual([
            expect.objectContaining({ quantity: 3, unitCost: 0 }),
        ]);
        expect(await run(dims, [usageFor('free', ['2'])], FreeDimensionOnInvoice.show)).toEqual([
            expect.objectContaining({ quantity: 0, unitCost: 0 }),
        ]);
    });
    it('charges only exhausted allowance overage, honours inf and forbidden overage', async () => {
        const dims = [
            dim({ dimensionId: 'over', consumptionPrice: '2', usageEntitlement: 10, overageAllowed: 'true' }),
            dim({ dimensionId: 'under', consumptionPrice: '2', usageEntitlement: 10, overageAllowed: 'true' }),
            dim({ dimensionId: 'exact', consumptionPrice: '2', usageEntitlement: 10, overageAllowed: 'true' }),
            dim({ dimensionId: 'unlimited', consumptionPrice: '2', usageEntitlement: 'inf', overageAllowed: 'true' }),
            dim({ dimensionId: 'noOverage', consumptionPrice: '2', usageEntitlement: 10, overageAllowed: 'false' }),
            dim({ dimensionId: 'implicitNoOverage', consumptionPrice: '2', usageEntitlement: 10 }),
            dim({ dimensionId: 'noAllowance', consumptionPrice: '2' }),
            dim({ dimensionId: 'noUsage', consumptionPrice: '2' }),
        ];
        const usage = [
            usageFor('over', ['12']),
            usageFor('under', ['4']),
            usageFor('exact', ['10']),
            usageFor('unlimited', ['1000']),
            usageFor('noOverage', ['30']),
            usageFor('implicitNoOverage', ['30']),
            usageFor('noAllowance', ['7']),
            usageFor('noUsage', ['0']),
        ];
        expect(await run(dims, usage, FreeDimensionOnInvoice.show)).toEqual([
            expect.objectContaining({ name: 'over - Plan', quantity: 2, unitCost: 2 }),
            expect.objectContaining({ name: 'noAllowance - Plan', quantity: 7, unitCost: 2 }),
        ]);
    });
    it('respects usage increments and free trial credits on the owed quantity', async () => {
        const dims = [
            dim({
                dimensionId: 'inc',
                consumptionPrice: '2',
                usageIncrement: '10',
                usageEntitlement: 100,
                overageAllowed: 'true',
            }),
        ];
        expect(await run(dims, [usageFor('inc', ['150'])], FreeDimensionOnInvoice.show)).toEqual([
            expect.objectContaining({ quantity: 5, unitCost: 2 }),
        ]);
        expect(await run(dims, [usageFor('inc', ['150'])], FreeDimensionOnInvoice.show, true)).toEqual([
            expect.objectContaining({ quantity: -5, unitCost: 2 }),
        ]);
    });
    it('treats a priced-out dimension with only an allowance as free', async () => {
        const dims = [dim({ dimensionId: 'included', usageEntitlement: 50, overageAllowed: 'false' })];
        expect(await run(dims, [usageFor('included', ['60'])], FreeDimensionOnInvoice.show)).toEqual([
            expect.objectContaining({ quantity: 0, unitCost: 0 }),
        ]);
        expect(await run(dims, [usageFor('included', ['60'])], FreeDimensionOnInvoice.hide)).toEqual([]);
    });
    it('applies the allowance to the last reading when aggregation is last', async () => {
        const dims = [
            dim({
                dimensionId: 'last',
                consumptionPrice: '3',
                aggregationMethod: 'last',
                usageEntitlement: 5,
                overageAllowed: 'true',
            }),
        ];
        expect(await run(dims, [usageFor('last', ['100', '8'])], FreeDimensionOnInvoice.show)).toEqual([
            expect.objectContaining({ quantity: 3, unitCost: 3 }),
        ]);
    });
});
