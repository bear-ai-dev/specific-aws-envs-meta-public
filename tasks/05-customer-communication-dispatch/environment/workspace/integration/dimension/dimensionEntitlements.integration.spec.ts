import { AggregationInterval, AggregationMethod, OverageAllowed, Rounding } from '../client/publicClient/dimension.js';
import { Invoice } from '../client/publicClient/invoice.js';
import { Usage } from '../client/publicClient/usage.js';
import { Scheduler } from '../client/privateClient/scheduler.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleSubscriptionOffering,
    setupSimpleUsageBasedOffering,
} from '../setupAndTeardown/setup.js';
import { sleep } from '../utils/utils.js';
import { DatetimeUtils } from '../utils/Datetime.js';

describe('Dimension Entitlements', () => {
    test('should allow the user to set an entitlement value on usage based dimensions, happy path', async () => {
        const usageIncrement = 1;
        const noMeasurementId = null;
        const dimensionName = 'Request';
        const consumptionUnit = 'count-based';
        const consumptionType = 'count';
        const usageEntitlement = 4;
        const dimension = await setupDimensionRequest(
            noMeasurementId,
            AggregationMethod.Count,
            dimensionName,
            Rounding.Ceiling,
            usageIncrement.toString(),
            consumptionUnit,
            consumptionType,
            usageEntitlement
        );
        await sleep(1000 * 5);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(1000 * 5);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        const usage = new Usage();
        const usageInput = ['1', '2', '3', '4', '5'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 10);
        const customerUsage = await customer.getUsage(
            new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
            new Date().toISOString(),
            AggregationInterval.Hour
        );
        const testValue = customerUsage[0].usage[customerUsage[0].usage.length - 1].value;
        // Usage calculation is not effected by entitlements
        expect(testValue).toEqual(usageInput.length.toString());
        // Invoice calculation is effected by entitlements and should consider the entitlement and overage in the calculation
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        expect(invoice.totalAmountWithoutTax).toEqual((usageInput.length - usageEntitlement) * 0.4);
        const lineItem = invoice.lineItems[0];
        expect(lineItem.name).toEqual(`${dimensionName} - ${offering.offeringName}`);
        expect(lineItem.quantity).toEqual(usageInput.length - usageEntitlement);
    });
    test('should allow entitlements for subscription based offerings and not appear in the bill', async () => {
        const usageIncrement = 1;
        const noMeasurementId = null;
        const dimensionName = 'Request';
        const consumptionUnit = 'count-based';
        const consumptionType = 'count';
        const usageEntitlement = 10;
        const dimension = await setupDimensionRequest(
            noMeasurementId,
            AggregationMethod.Count,
            dimensionName,
            Rounding.Ceiling,
            usageIncrement.toString(),
            consumptionUnit,
            consumptionType,
            usageEntitlement
        );
        await sleep(1000 * 5);
        const offering = await setupSimpleSubscriptionOffering({
            dimensionIds: [dimension.dimensionId],
            subscriptionPrice: 10,
        });
        await sleep(1000 * 5);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        const usage = new Usage();
        const usageInput = ['1', '2', '3', '4', '5'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 10);
        const customerUsage = await customer.getUsage(
            new Date(new Date().getTime() - 1000 * 60 * 60).toISOString(),
            new Date().toISOString(),
            AggregationInterval.Day
        );
        const testValue = customerUsage[0].usage[customerUsage[0].usage.length - 1].value;
        // Usage calculation is not effected by entitlements
        expect(testValue).toEqual(usageInput.length.toString());
        // Invoice calculation is effected by entitlements and should consider the entitlement and overage in the calculation
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
        await sleep(1000 * 10);
        // Validate the invoice was created
        const customerData = await customer.get();
        // One invoice is created when the customer is created
        // One invoice is created when the billing job is run
        // We should not be relying on order of invoices here: TODO: fix this it can be flaky
        expect(customerData.invoices.length).toBe(2);
        const invoice = customerData.invoices[0];

        expect(invoice.totalAmountWithoutTax).toEqual(offering.subscriptionPrice);
        const lineItem = invoice.lineItems[0];
        expect(lineItem.name).toEqual(`${offering.offeringName}`);
        expect(lineItem.quantity).toEqual(1);
    });
    test('Should allow overage for subscription dimensions', async () => {
        const usageIncrement = 1;
        const noMeasurementId = null;
        const dimensionName = 'Request';
        const consumptionUnit = 'count-based';
        const consumptionType = 'count';
        const usageEntitlement = 4;

        const dimension = await setupDimensionRequest(
            noMeasurementId,
            AggregationMethod.Count,
            dimensionName,
            Rounding.Ceiling,
            usageIncrement.toString(),
            consumptionUnit,
            consumptionType,
            usageEntitlement,
            OverageAllowed.True
        );
        await sleep(1000 * 5);
        const offering = await setupSimpleSubscriptionOffering({
            dimensionIds: [dimension.dimensionId],
            subscriptionPrice: 10,
        });
        await sleep(1000 * 5);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(1000 * 5);
        const usage = new Usage();
        const usageInput = ['1', '2', '3', '4', '5'];
        // Get a date from the prior month and use that for timestamp, should be slightly different for each loop
        let timestamp;
        let jitter;
        for (const value of usageInput) {
            // add jitter
            jitter = Math.floor(Math.random() * 1000 * 60 * 60 * 24);
            // Around the fifth day of the month
            timestamp = new Date(
                DatetimeUtils.firstDayOfLastMonth().getTime() + 1000 * 60 * 60 * 24 * 5 + jitter
            ).toISOString();
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
                timestamp,
            });
        }
        await sleep(1000 * 10);

        const res = await Scheduler.pushSingleJobToQueue(
            new Scheduler({
                schedulerStatus: 'live',
                schedulerType: 'billing',
                scheduleParameters: {
                    customerId: customer.customerId,
                    startDateOverride: DatetimeUtils.firstDayOfLastMonth().toISOString(),
                    endDateOverride: DatetimeUtils.lastDayOfLastMonth().toISOString(),
                },
            })
        );
        expect(res.message).toEqual('completed');
        await sleep(1000 * 10);
        // Validate the invoice was created
        const customerData = await customer.get();

        // One invoice is created when the customer is created
        // One invoice is created when the billing job is run
        expect(customerData.invoices.length).toBe(2);
        const invoice = customerData.invoices[0];
        expect(invoice.lineItems.length).toEqual(2);
        const lineItem = invoice.lineItems[0];
        expect(lineItem.name).toEqual(`${offering.offeringName}`);
        expect(lineItem.quantity).toEqual(1);

        // dimension with overage
        const lineItem2 = invoice.lineItems[1];
        expect(lineItem2.name).toEqual(`${dimensionName} - ${offering.offeringName}`);
        expect(lineItem2.quantity).toEqual(usageInput.length - usageEntitlement);
    });
});
