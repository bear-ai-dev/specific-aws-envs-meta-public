import { Customer } from '../client/publicClient/customer.js';
import { AggregationMethod } from '../client/publicClient/dimension.js';
import { Offering } from '../client/publicClient/offering.js';
import { Usage } from '../client/publicClient/usage.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
    setupUsageBasedFreeTrial,
} from '../setupAndTeardown/setup.js';
import { DatetimeUtils } from '../utils/Datetime.js';
import { sleep } from '../utils/utils.js';

describe('Billing', () => {
    test('Switching offering creates invoice for current usage', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        const customerobj = await customer.get();
        expect(customerobj.offeringId).toBe(offering.offeringId);
        expect(customerobj.offeringEnrollmentDate).toBeDefined();
        await sleep(1000 * 5);
        const usage = new Usage();
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        for (const value of usageInput) {
            await sleep(100);
            const usageTimestamp = new Date().toISOString();
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
                timestamp: usageTimestamp,
            });
        }
        await sleep(1000 * 3);
        const offering2 = await setupSimpleUsageBasedOffering();
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1000 * 3);
        const { invoices, offeringEnrollmentDate } = await customer.get();
        const invoice = invoices[0];
        expect(invoices.length).toBe(1);
        expect(invoice?.invoiceId).toEqual(expect.any(String));
        expect(invoice.lineItems.length).toBe(1);
        expect(invoice.lineItems[0].quantity).toBe(10);
        expect(invoice.lineItems[0].unitCost).toBe(0.4);
        expect(invoice.totalAmountWithoutTax).toEqual(4);
        expect(invoice.lineItems[0].name).toBe(`${dimension.dimensionName} - ${offering.offeringName}`);
    });
    test('Free Trial Length should set number of days correctly for usage based offerings', async () => {
        const { offeringId } = await setupUsageBasedFreeTrial({ freeTrialLength: '1' });
        const offering = await Offering.getById(offeringId as string);
        expect(offering.freeTrialLength).toEqual('1');
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(fullCustomerInformation.freeTrialEndDate).toBeDefined();
        const freeTrialDate = new Date(fullCustomerInformation.freeTrialEndDate as string);
        // Get Tomorrow's date
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        // expect the free trial date to be tomorrow
        expect(DatetimeUtils.isSameDay(freeTrialDate, tomorrow)).toBeTruthy();
    });

    test('When Changing UsageBased offering to another Offering Credit should not be applied', async () => {
        const offering1 = await setupSimpleUsageBasedOffering();
        const offering2 = await setupSimpleUsageBasedOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering1.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering1.offeringId);
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering2.offeringId);
        const customerObject = await customer.get();
        expect(customerObject.invoices.length).toBe(1);
        const credit = customerObject.creditBalance;
        expect(credit).toBeDefined();
        expect(parseFloat(credit)).toBe(0);
    });
    test('Free Trial Length can be far in the future for usage based offerings', async () => {
        const { offeringId } = await setupUsageBasedFreeTrial({ freeTrialLength: '900' });
        const offering = await Offering.getById(offeringId as string);
        expect(offering.freeTrialLength).toEqual('900');
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(fullCustomerInformation.freeTrialEndDate).toBeDefined();
        const freeTrialDate = new Date(fullCustomerInformation.freeTrialEndDate as string);
        // Get 900 days from now
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 900);
        // expect the free trial date to be tomorrow
        expect(DatetimeUtils.isSameDay(freeTrialDate, futureDate)).toBeTruthy();
    });
});
