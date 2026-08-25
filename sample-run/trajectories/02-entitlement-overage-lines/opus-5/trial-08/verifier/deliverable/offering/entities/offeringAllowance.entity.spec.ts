import { Offering } from './offeringPackage.entity.js';
import { InvoiceLineItem, InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';
import { AggregatedUsageResponse } from '../../customer/dto/read-customer.dto.js';
import { ReadOfferingResponseData } from '../dto/readOffering.dto.js';
import {
    aggregationInterval,
    aggregationMethod,
    countBasedUnits,
    overageAllowedEnum,
    ReadDimensionResponseData,
    roundingEnum,
} from '../../dimensions/dto/create-dimension.dto.js';
import { OfferingType } from './OfferingType.js';
import { OfferingVisibility } from '../dto/createOffering.dto.js';

const offeringId = 'off-allowance';
const businessID = 'biz-allowance';
const customerId = 'cus-allowance';
const startDate = new Date('2026-07-01T00:00:00.000Z');
const endDate = new Date('2026-08-01T00:00:00.000Z');

const dimension = (dimensionId: string, overrides: Partial<ReadDimensionResponseData>): ReadDimensionResponseData =>
    ({
        dimensionId,
        dimensionName: dimensionId,
        aggregationInterval: aggregationInterval.hour,
        aggregationMethod: aggregationMethod.sum,
        rounding: roundingEnum.round,
        usageIncrement: '1',
        consumptionUnit: { unit: countBasedUnits['count-based'], type: 'count' },
        ...overrides,
    }) as ReadDimensionResponseData;

const linesFor = async ({
    dimensions,
    totals,
    freeDimensionOnInvoice,
}: {
    dimensions: ReadDimensionResponseData[];
    totals: Record<string, number>;
    freeDimensionOnInvoice?: FreeDimensionOnInvoice;
}): Promise<InvoiceLineItem[]> => {
    const usageOverrides: AggregatedUsageResponse[] = dimensions.map(({ dimensionId }) => ({
        offeringId,
        dimensionId,
        usage: [
            {
                value: `${totals[dimensionId] ?? 0}`,
                startTime: startDate.toISOString(),
                endTime: endDate.toISOString(),
            },
        ],
    }));
    const offeringConfig = {
        offeringId,
        offeringName: 'Allowance Offering',
        offeringType: OfferingType.usageBased,
        offeringVisibility: OfferingVisibility.public,
        billingCycle: 'monthly',
        dimensions,
    } as unknown as ReadOfferingResponseData;
    const offeringInstance = Offering.getInstance(
        offeringConfig,
        customerId,
        businessID,
        undefined,
        { freeDimensionOnInvoice } as ReadSettingsResponseData,
        undefined,
        undefined,
        undefined,
        usageOverrides,
    );
    const lineItems = new InvoiceLineItems();
    await Offering.getLineItemsForUsage({
        startDate,
        endDate,
        lineItems,
        businessID,
        customerId,
        customerService: undefined,
        dimensions,
        offeringInstance,
    });
    return lineItems.getLineItems();
};

describe('Allowances, overage and free dimensions on invoice lines', () => {
    describe('chargeableUsage', () => {
        it('charges every unit when the dimension carries no allowance', () => {
            expect(Offering.chargeableUsage({ total: 25 })).toEqual(25);
        });
        it('charges only the usage past a finite exhausted allowance', () => {
            expect(
                Offering.chargeableUsage({
                    total: 150,
                    usageEntitlement: 100,
                    overageAllowed: overageAllowedEnum.true,
                }),
            ).toEqual(50);
        });
        it('charges nothing while the allowance is unexhausted', () => {
            expect(
                Offering.chargeableUsage({
                    total: 30,
                    usageEntitlement: 100,
                    overageAllowed: overageAllowedEnum.true,
                }),
            ).toEqual(0);
            expect(
                Offering.chargeableUsage({
                    total: 100,
                    usageEntitlement: 100,
                    overageAllowed: overageAllowedEnum.true,
                }),
            ).toEqual(0);
        });
        it('charges nothing for an unlimited allowance', () => {
            expect(
                Offering.chargeableUsage({
                    total: 900,
                    usageEntitlement: 'inf',
                    overageAllowed: overageAllowedEnum.true,
                }),
            ).toEqual(0);
        });
        it('charges nothing when the plan forbids overage', () => {
            expect(
                Offering.chargeableUsage({
                    total: 40,
                    usageEntitlement: 10,
                    overageAllowed: overageAllowedEnum.false,
                }),
            ).toEqual(0);
            expect(Offering.chargeableUsage({ total: 40, usageEntitlement: 10 })).toEqual(0);
        });
    });

    it('gives a line only to the dimensions the customer owes something on', async () => {
        const dimensions = [
            dimension('plain', { consumptionPrice: '0.10' }),
            dimension('exhausted', {
                consumptionPrice: '1.00',
                usageEntitlement: 100,
                overageAllowed: overageAllowedEnum.true,
            }),
            dimension('unexhausted', {
                consumptionPrice: '1.00',
                usageEntitlement: 100,
                overageAllowed: overageAllowedEnum.true,
            }),
            dimension('unlimited', {
                consumptionPrice: '1.00',
                usageEntitlement: 'inf',
                overageAllowed: overageAllowedEnum.true,
            }),
            dimension('overageForbidden', {
                consumptionPrice: '1.00',
                usageEntitlement: 10,
                overageAllowed: overageAllowedEnum.false,
            }),
            dimension('unused', { consumptionPrice: '3.00' }),
        ];
        const lines = await linesFor({
            dimensions,
            totals: { plain: 25, exhausted: 150, unexhausted: 30, unlimited: 900, overageForbidden: 40, unused: 0 },
        });
        expect(lines).toEqual([
            expect.objectContaining(new InvoiceLineItem('plain - Allowance Offering', 25, 0.1)),
            expect.objectContaining(new InvoiceLineItem('exhausted - Allowance Offering', 50, 1)),
        ]);
    });

    it('reports the owed quantity on a dimension the plan prices at zero', async () => {
        const lines = await linesFor({
            dimensions: [dimension('free', { consumptionPrice: '0.00' })],
            totals: { free: 7 },
            freeDimensionOnInvoice: FreeDimensionOnInvoice.show,
        });
        expect(lines).toEqual([expect.objectContaining(new InvoiceLineItem('free - Allowance Offering', 7, 0))]);
    });

    it('keeps free dimensions off the invoice when the settings hide them', async () => {
        const dimensions = [
            dimension('free', { consumptionPrice: '0.00' }),
            dimension('paid', { consumptionPrice: '2.00' }),
        ];
        const lines = await linesFor({
            dimensions,
            totals: { free: 7, paid: 3 },
            freeDimensionOnInvoice: FreeDimensionOnInvoice.hide,
        });
        expect(lines).toEqual([expect.objectContaining(new InvoiceLineItem('paid - Allowance Offering', 3, 2))]);
    });
});
