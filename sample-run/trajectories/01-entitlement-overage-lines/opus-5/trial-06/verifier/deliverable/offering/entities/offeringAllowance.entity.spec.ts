import {
    aggregationInterval,
    aggregationMethod,
    countBasedUnits,
    overageAllowedEnum,
    roundingEnum,
} from '../../dimensions/dto/create-dimension.dto.js';
import { InvoiceLineItem, InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';
import { ValidBillingCycles } from '../dto/createOffering.dto.js';
import { ReadOfferingResponseData } from '../dto/readOffering.dto.js';
import { SupportedCurrencies } from '../dto/SupportedCurrencies.js';
import { OfferingType } from './OfferingType.js';
import { Offering } from './offeringPackage.entity.js';

jest.mock('../../analytics/analytics.service', () => ({
    AnalyticsService: {
        getExchangeRate: jest.fn(() => 0.91),
    },
}));

const businessID = 'fakeBusinessID';
const customerId = 'fakeCustomerID';
const dimensionId = '123';
const startDate = new Date('2026-07-01T00:00:00.000Z');
const endDate = new Date('2026-08-01T00:00:00.000Z');

const dimensionWith = (overrides: Record<string, unknown>) =>
    ({
        dimensionId,
        dimensionName: 'fakeDimensionName',
        aggregationInterval: aggregationInterval.hour,
        aggregationMethod: aggregationMethod.sum,
        rounding: roundingEnum.round,
        usageIncrement: '1',
        consumptionUnit: {
            unit: countBasedUnits['count-based'],
            type: 'count',
        },
        ...overrides,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any;

const linesFor = async ({
    dimension,
    usageTotal,
    freeDimensionOnInvoice,
}: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dimension: any;
    usageTotal: number;
    freeDimensionOnInvoice?: FreeDimensionOnInvoice;
}): Promise<InvoiceLineItem[]> => {
    const offeringConfig = {
        offeringId: 'offeringId',
        offeringName: 'foobar',
        offeringType: OfferingType.usageBased,
        currency: SupportedCurrencies.USD,
        billingCycle: ValidBillingCycles.monthly,
        dimensions: [dimension],
    } as ReadOfferingResponseData;
    const offeringInstance = Offering.getInstance(
        offeringConfig,
        customerId,
        businessID,
        undefined,
        { freeDimensionOnInvoice } as ReadSettingsResponseData,
        undefined,
        undefined,
        undefined,
        [
            {
                offeringId: 'offeringId',
                dimensionId,
                usage: [
                    {
                        value: usageTotal.toString(),
                        startTime: startDate.toISOString(),
                        endTime: endDate.toISOString(),
                    },
                ],
            },
        ],
    );
    const lineItems = new InvoiceLineItems();
    await Offering.getLineItemsForUsage({
        startDate,
        endDate,
        lineItems,
        negative: false,
        businessID,
        customerId,
        customerService: undefined,
        dimensions: offeringConfig.dimensions,
        offeringInstance,
    });
    return lineItems.getLineItems();
};

describe('Allowances, overage and free dimensions', () => {
    test('every unit of usage is charged for when the plan grants no allowance', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({ consumptionPrice: '0.50' }),
                usageTotal: 10,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 10, 0.5))]);
    });

    test('only the usage past an exhausted allowance is charged for when overage is permitted', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({
                    consumptionPrice: '0.50',
                    usageEntitlement: 4,
                    overageAllowed: overageAllowedEnum.true,
                }),
                usageTotal: 10,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 6, 0.5))]);
    });

    test('an allowance which has not been used up in full charges nothing and earns no line', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({
                    consumptionPrice: '0.50',
                    usageEntitlement: 40,
                    overageAllowed: overageAllowedEnum.true,
                }),
                usageTotal: 10,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([]);
    });

    test('usage which exactly meets the allowance charges nothing', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({
                    consumptionPrice: '0.50',
                    usageEntitlement: 10,
                    overageAllowed: overageAllowedEnum.true,
                }),
                usageTotal: 10,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([]);
    });

    test('an unlimited allowance charges nothing however much is used', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({
                    consumptionPrice: '0.50',
                    usageEntitlement: 'inf',
                    overageAllowed: overageAllowedEnum.true,
                }),
                usageTotal: 1000,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([]);
    });

    test('a plan which forbids overage charges nothing for the usage past the allowance', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({
                    consumptionPrice: '1.00',
                    usageEntitlement: 5,
                    overageAllowed: overageAllowedEnum.false,
                }),
                usageTotal: 7,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([]);
    });

    test('an allowance without an overage rule charges nothing for the usage past it', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({ consumptionPrice: '0.10', usageEntitlement: 50 }),
                usageTotal: 70,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([]);
    });

    test('a dimension the plan prices at zero earns a line reporting the quantity owed for', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({ consumptionPrice: '0.00' }),
                usageTotal: 5,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 5, 0))]);
    });

    test('a dimension the plan prices at zero is left off the invoice when free dimensions are hidden', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({ consumptionPrice: '0.00' }),
                usageTotal: 5,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.hide,
            }),
        ).toEqual([]);
    });

    test('a dimension priced at zero with an exhausted allowance reports only the quantity owed for', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({
                    consumptionPrice: '0',
                    usageEntitlement: 4,
                    overageAllowed: overageAllowedEnum.true,
                }),
                usageTotal: 10,
                freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
            }),
        ).toEqual([expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 6, 0))]);
    });

    test('free dimensions are shown when the business has expressed no preference', async () => {
        expect(
            await linesFor({
                dimension: dimensionWith({ consumptionPrice: '0' }),
                usageTotal: 5,
            }),
        ).toEqual([expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 5, 0))]);
    });

    test('billableQuantity understands allowances however they are expressed', () => {
        expect(Offering.billableQuantity({ usageTotal: 10 })).toEqual(10);
        expect(
            Offering.billableQuantity({
                usageTotal: 10,
                usageEntitlement: 0,
                overageAllowed: overageAllowedEnum.true,
            }),
        ).toEqual(10);
        expect(
            Offering.billableQuantity({
                usageTotal: 10,
                usageEntitlement: '4' as unknown as number,
                overageAllowed: overageAllowedEnum.true,
            }),
        ).toEqual(6);
        expect(
            Offering.billableQuantity({
                usageTotal: 10,
                usageEntitlement: 4,
                overageAllowed: true as unknown as overageAllowedEnum,
            }),
        ).toEqual(6);
        expect(Offering.billableQuantity({ usageTotal: 10, usageEntitlement: 'inf' })).toEqual(0);
        expect(Offering.billableQuantity({ usageTotal: NaN })).toEqual(0);
    });
});
