import { InvoiceLineGathererService } from './invoiceLineGatherer.service.js';

/**
 * These exercise the collector end to end against the local AWS compatible
 * emulator: the billing catalogues live in the billing bucket and the
 * aggregated usage lives in the metric store, keyed by business, customer and
 * dimension.
 */
describe('InvoiceLineGathererService', () => {
    jest.setTimeout(60000);
    let service: InvoiceLineGathererService;

    beforeEach(() => {
        service = new InvoiceLineGathererService();
    });

    describe('gatherInvoiceLines', () => {
        test('charges overage only past an exhausted finite allowance and hides free dimensions when asked', async () => {
            const assembled = await service.gatherInvoiceLines({
                businessID: 'biz-ridge',
                catalogueBucket: 'meteringco-billing-sandbox',
                catalogueKey: 'catalogues/biz-ridge-2026-07.json',
            });

            const alpha = assembled.find(({ customerId }) => customerId === 'cus_sample_alpha');
            expect(alpha?.offeringId).toEqual('off-ridge-plan');
            expect(alpha?.lineItems).toEqual([
                // No allowance: every unit is owed for.
                expect.objectContaining({ name: 'Ridge API Calls - Ridge Plan', quantity: 100, unitCost: 0.01 }),
                // Allowance of 10 exhausted by 12 seats, overage permitted.
                expect.objectContaining({ name: 'Ridge Seats - Ridge Plan', quantity: 2, unitCost: 10 }),
            ]);
            // Ridge Alerts is priced at zero and this business hides free
            // dimensions; Ridge Reports forbids overage; Ridge Storage carries
            // an unlimited allowance. None of them is owed for.
            expect(alpha?.lineItems.map(({ name }) => name)).not.toContain('Ridge Alerts - Ridge Plan');
            expect(alpha?.lineItems.map(({ name }) => name)).not.toContain('Ridge Reports - Ridge Plan');
            expect(alpha?.lineItems.map(({ name }) => name)).not.toContain('Ridge Storage - Ridge Plan');

            const bravo = assembled.find(({ customerId }) => customerId === 'cus_sample_bravo');
            expect(bravo?.lineItems).toEqual([
                expect.objectContaining({ name: 'Ridge Jobs - Ridge Metered', quantity: 200, unitCost: 0.05 }),
            ]);
            // Ridge Minutes has an allowance of 100 against 80 minutes of
            // usage, Ridge Scans an unlimited allowance, and Ridge Tasks an
            // allowance its plan does not let the customer exceed.
            expect(bravo?.lineItems.map(({ name }) => name)).not.toContain('Ridge Minutes - Ridge Metered');
            expect(bravo?.lineItems.map(({ name }) => name)).not.toContain('Ridge Scans - Ridge Metered');
            expect(bravo?.lineItems.map(({ name }) => name)).not.toContain('Ridge Tasks - Ridge Metered');
        });

        test('lists dimensions priced at zero, with the quantity owed for, when the business shows them', async () => {
            const assembled = await service.gatherInvoiceLines({
                businessID: 'biz-vale',
                catalogueBucket: 'meteringco-billing-sandbox',
                catalogueKey: 'catalogues/biz-vale-2026-07.json',
            });

            const charlie = assembled.find(({ customerId }) => customerId === 'cus_sample_charlie');
            expect(charlie?.lineItems).toEqual([
                expect.objectContaining({ name: 'Vale Messages - Vale Plan', quantity: 50, unitCost: 0.01 }),
                expect.objectContaining({ name: 'Vale Hours - Vale Plan', quantity: 10, unitCost: 0 }),
                expect.objectContaining({ name: 'Vale Units - Vale Plan', quantity: 5, unitCost: 5 }),
            ]);
        });
    });
});
