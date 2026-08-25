import {
    setupCustomerWallStrTrading,
    setupSimpleSubscriptionOffering,
    setupSimpleUsageBasedOffering,
    setupSubscriptionFreeTrial,
} from '../setupAndTeardown/setup.js';
import { VALID_PRICE, INVALID_PRICE } from './subscription.integration.input.js';
import { lastDayOfMonth, sleep } from '../utils/utils.js';
import { Invoice, InvoiceStatus } from '../client/publicClient/invoice.js';
import { Scheduler } from '../client/privateClient/scheduler.js';
import { DatetimeUtils } from '../utils/Datetime.js';
import { Customer } from '../client/publicClient/customer.js';
import { Offering } from '../client/publicClient/offering.js';

describe('Billing', () => {
    test('Invoice immediate due', async () => {
        const offering = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        const customerObject = await customer.get();
        expect(customerObject.invoices.length).toBe(1);
        const invoice = new Invoice(customerObject.invoices[0]);
        expect(invoice.invoiceStatus).toBe(InvoiceStatus.DRAFT);

        let startDate: Date = new Date();
        let endDate: Date = DatetimeUtils.lastDayOfMonth();
        startDate = DatetimeUtils.beginningOfDay(startDate);
        endDate = DatetimeUtils.endOfDay(endDate);
        const billingDays: number = Math.round(
            Math.abs((endDate.getTime() - startDate.getTime()) / DatetimeUtils.oneDay)
        );
        const amountDue: number =
            Math.round(100 * offering.subscriptionPrice * (billingDays / DatetimeUtils.totalDaysInMonth())) / 100;

        expect(invoice.totalAmountWithoutTax).toBeCloseTo(amountDue);
        expect(invoice.invoiceDate).toBe(new Date().toISOString().substring(0, 10));
        expect(invoice.lineItems.length).toBe(1);
        expect(invoice.lineItems[0].quantity).toBe(1);
        expect(invoice.lineItems[0].unitCost).toBeCloseTo(amountDue);
        expect(invoice.lineItems[0].name).toBe(offering.offeringName);
    });

    test('Scheduler', async () => {
        const offering = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        const [{ id: schedulerId }] = await Scheduler.get(customer.customerId);
        expect(schedulerId).toEqual(expect.anything());
    });

    test('Monthly payment', async () => {
        const offering = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        const res = await Scheduler.pushSingleJobToQueue(
            new Scheduler({
                schedulerStatus: 'live',
                schedulerType: 'billing',
                scheduleParameters: {
                    customerId: customer.customerId,
                },
            })
        );
        expect(res.message).toEqual('completed');
        await sleep(1000 * 60);
        const customerObject = await customer.get();
        expect(customerObject.invoices.length).toBe(2);
        const invoices = customerObject.invoices;
        invoices.sort((a, b) => {
            const dateA = new Date(a.invoiceDate);
            const dateB = new Date(b.invoiceDate);
            if (dateA < dateB) {
                return -1;
            }
            if (dateA > dateB) {
                return 1;
            }
            return 0;
        });
        const invoice = new Invoice(customerObject.invoices[0]);
        expect(invoice.invoiceStatus).toBe(InvoiceStatus.DRAFT);
        expect(invoice.totalAmountWithoutTax).toBeCloseTo(offering.subscriptionPrice);
        expect(invoice.invoiceDate).toBe(DatetimeUtils.firstDayOfMonth().toISOString().substring(0, 10));
        expect(invoice.lineItems.length).toBe(1);
        expect(invoice.lineItems[0].quantity).toBe(1);
        expect(invoice.lineItems[0].unitCost).toBeCloseTo(offering.subscriptionPrice);
        expect(invoice.lineItems[0].name).toBe(offering.offeringName);
    });
});

describe('Subscription', () => {
    test('Basic Case', async () => {
        const offering = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering.offeringId);
    });
    test('When Changing Subscription to another Subscription Credit should be applied', async () => {
        const offering1 = await setupSimpleSubscriptionOffering({ subscriptionPrice: 10 });
        const offering2 = await setupSimpleSubscriptionOffering({ subscriptionPrice: 20 });
        const customer = await setupCustomerWallStrTrading({ offeringId: offering1.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering1.offeringId);
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering2.offeringId);
        const customerObject = await customer.get();
        expect(customerObject.invoices.length).toBe(3);
        const credit = customerObject.creditBalance;
        expect(credit).toBeDefined();
        expect(parseFloat(credit)).toBeLessThan(offering1.subscriptionPrice);
        
    });

    test('Enrollment', async () => {
        const offering = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading();
        await sleep(1000 * 5);
        customer.update({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering.offeringId);
    });

    test('Unenrollment', async () => {
        const offering = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering.offeringId);
        await customer.update({ offeringId: null });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe('');
    });

    test('Re-enrollment', async () => {
        const offering = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering.offeringId);
        await customer.update({ offeringId: null });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe('');
        customer.update({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering.offeringId);
    });

    test('Change Subscription', async () => {
        const offering1 = await setupSimpleSubscriptionOffering();
        const offering2 = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering1.offeringId });
        expect((await customer.get()).offeringId).toBe(offering1.offeringId);
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering2.offeringId);
    });

    test('Change from usage-based plan', async () => {
        const offering1 = await setupSimpleSubscriptionOffering();
        const offering2 = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering1.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering1.offeringId);
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering2.offeringId);
    });

    test('Change to usage-based plan', async () => {
        const offering1 = await setupSimpleSubscriptionOffering();
        const offering2 = await setupSimpleSubscriptionOffering();
        const customer = await setupCustomerWallStrTrading({ offeringId: offering1.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering1.offeringId);
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1000 * 5);
        expect((await customer.get()).offeringId).toBe(offering2.offeringId);
    });
    test('Offering updates should not change currency', async () => {
        const offering1 = await setupSimpleSubscriptionOffering();
        const offeringResponse = await offering1.get();
        expect(offeringResponse.currency).toBe('USD');
        await offering1.update({ offeringName: 'New Name' });
        await sleep(1000 * 5);
        const offeringResponse2 = await offering1.get();
        expect(offeringResponse2.currency).toBe('USD');
    });

    test.concurrent.each(VALID_PRICE)('Valid subscription price %p', async (price) => {
        const offering = await setupSimpleSubscriptionOffering({ subscriptionPrice: price });
        await sleep(1000 * 5);
        expect((await offering.get()).subscriptionPrice).toBe(price);
    });

    test.concurrent.each(INVALID_PRICE)('Invalid subscription price %p', async (price) => {
        await expect(setupSimpleSubscriptionOffering({ subscriptionPrice: price })).rejects.toThrow();
    });

    test('Subscription Free trial length should set the trial in days', async () => {
        const { offeringId } = await setupSubscriptionFreeTrial({ freeTrialLength: '25' });
        const offering = await Offering.getById(offeringId as string);
        expect(offering.freeTrialLength).toEqual('25');
        await sleep(1000 * 2);

        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 2);
        expect(offering.freeTrialLength).toEqual('25');
        const fullCustomerInformation = (await customer.get()) as Customer;
        console.log(JSON.stringify(fullCustomerInformation, null, 2));
        expect(fullCustomerInformation.freeTrialEndDate).toBeDefined();
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 25);
        // expect the free trial date to be tomorrow
        const freeTrialEnd = new Date(fullCustomerInformation.freeTrialEndDate as string);
        expect(DatetimeUtils.isSameDay(freeTrialEnd, futureDate)).toBeTruthy();
    });
});
