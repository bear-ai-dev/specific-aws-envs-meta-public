import { Offering } from './offeringPackage.entity.js';
import { InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';
import {
    aggregationInterval,
    aggregationMethod,
    countBasedUnits,
    overageAllowedEnum,
    ReadDimensionResponseData,
    roundingEnum,
} from '../../dimensions/dto/create-dimension.dto.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';
import { ValidBillingCycles } from '../dto/createOffering.dto.js';
import { AggregatedUsageResponse } from '../../customer/dto/read-customer.dto.js';

const dimension = (overrides: Partial<ReadDimensionResponseData>): ReadDimensionResponseData =>
    ({
        dimensionName: overrides.dimensionId,
        usageIncrement: '1',
        rounding: roundingEnum.round,
        aggregationInterval: aggregationInterval.hour,
        aggregationMethod: aggregationMethod.sum,
        consumptionUnit: { unit: countBasedUnits['count-based'], type: 'count' },
        ...overrides,
    }) as ReadDimensionResponseData;

const usageFor = (dimensionId: string, value: string): AggregatedUsageResponse =>
    ({
        dimensionId,
        usage: [{ value, startTime: '2026-07-02T00:00:00Z', endTime: '2026-07-02T00:00:00Z' }],
    }) as AggregatedUsageResponse;

const linesFor = async ({
    dimensions,
    usage,
    freeDimensionOnInvoice,
}: {
    dimensions: ReadDimensionResponseData[];
    usage: AggregatedUsageResponse[];
    freeDimensionOnInvoice?: FreeDimensionOnInvoice;
}) => {
    const lineItems = new InvoiceLineItems();
    await Offering.getLineItemsForUsage({
        startDate: new Date('2026-07-01T00:00:00Z'),
        endDate: new Date('2026-08-01T00:00:00Z'),
        lineItems,
        negative: false,
        businessID: 'fakeBusinessID',
        customerId: 'fakeCustomerID',
        customerService: undefined,
        dimensions,
        offeringInstance: {
            offeringName: 'Plan',
            billingCycle: ValidBillingCycles.monthly,
            settings: { freeDimensionOnInvoice } as ReadSettingsResponseData,
            usageOverrides: usage,
            dimensions,
        } as unknown as Offering,
    });
    return lineItems.getLineItems();
};

describe('Offering allowances, overage and free dimensions', () => {
    describe('chargeableQuantity', () => {
        it('owes for every unit consumed when the plan grants no allowance', () => {
            expect(Offering.chargeableQuantity({ total: '25', dimension: dimension({ dimensionId: 'a' }) })).toEqual(
                25,
            );
        });
        it('owes for nothing when the allowance is unlimited', () => {
            expect(
                Offering.chargeableQuantity({
                    total: '25',
                    dimension: dimension({
                        dimensionId: 'a',
                        usageEntitlement: 'inf',
                        overageAllowed: overageAllowedEnum.true,
                    }),
                }),
            ).toEqual(0);
        });
        it('owes for nothing while the allowance is not exhausted', () => {
            expect(
                Offering.chargeableQuantity({
                    total: '25',
                    dimension: dimension({
                        dimensionId: 'a',
                        usageEntitlement: 100,
                        overageAllowed: overageAllowedEnum.true,
                    }),
                }),
            ).toEqual(0);
        });
        it('owes only for what was consumed beyond an exhausted allowance', () => {
            expect(
                Offering.chargeableQuantity({
                    total: '25',
                    dimension: dimension({
                        dimensionId: 'a',
                        usageEntitlement: 10,
                        overageAllowed: overageAllowedEnum.true,
                    }),
                }),
            ).toEqual(15);
        });
        it('owes for nothing when the plan forbids overage', () => {
            expect(
                Offering.chargeableQuantity({
                    total: '25',
                    dimension: dimension({
                        dimensionId: 'a',
                        usageEntitlement: 10,
                        overageAllowed: overageAllowedEnum.false,
                    }),
                }),
            ).toEqual(0);
            expect(
                Offering.chargeableQuantity({
                    total: '25',
                    dimension: dimension({ dimensionId: 'a', usageEntitlement: 10 }),
                }),
            ).toEqual(0);
        });
    });

    it('lines up only the dimensions the customer owes something on', async () => {
        const dimensions = [
            dimension({ dimensionId: 'metered', consumptionPrice: '2' }),
            dimension({ dimensionId: 'unused', consumptionPrice: '2' }),
            dimension({
                dimensionId: 'unlimited',
                consumptionPrice: '2',
                usageEntitlement: 'inf',
                overageAllowed: overageAllowedEnum.true,
            }),
            dimension({
                dimensionId: 'included',
                consumptionPrice: '2',
                usageEntitlement: 100,
                overageAllowed: overageAllowedEnum.true,
            }),
            dimension({
                dimensionId: 'overage',
                consumptionPrice: '2',
                usageEntitlement: 10,
                overageAllowed: overageAllowedEnum.true,
            }),
            dimension({
                dimensionId: 'capped',
                consumptionPrice: '2',
                usageEntitlement: 10,
                overageAllowed: overageAllowedEnum.false,
            }),
        ];
        const usage = [
            usageFor('metered', '25'),
            usageFor('unlimited', '40'),
            usageFor('included', '30'),
            usageFor('overage', '30'),
            usageFor('capped', '30'),
        ];
        expect(await linesFor({ dimensions, usage, freeDimensionOnInvoice: FreeDimensionOnInvoice.show })).toEqual([
            expect.objectContaining({ name: 'metered - Plan', quantity: 25, unitCost: 2 }),
            expect.objectContaining({ name: 'overage - Plan', quantity: 20, unitCost: 2 }),
        ]);
    });

    it('lines up a dimension the plan prices at zero with the quantity owed for, unless free dimensions are hidden', async () => {
        const dimensions = [
            dimension({ dimensionId: 'free', consumptionPrice: '0' }),
            dimension({
                dimensionId: 'freeOverage',
                consumptionPrice: '0.00',
                usageEntitlement: 10,
                overageAllowed: overageAllowedEnum.true,
            }),
        ];
        const usage = [usageFor('free', '7'), usageFor('freeOverage', '30')];
        expect(await linesFor({ dimensions, usage, freeDimensionOnInvoice: FreeDimensionOnInvoice.show })).toEqual([
            expect.objectContaining({ name: 'free - Plan', quantity: 7, unitCost: 0 }),
            expect.objectContaining({ name: 'freeOverage - Plan', quantity: 20, unitCost: 0 }),
        ]);
        expect(await linesFor({ dimensions, usage, freeDimensionOnInvoice: FreeDimensionOnInvoice.hide })).toEqual([]);
    });
});
