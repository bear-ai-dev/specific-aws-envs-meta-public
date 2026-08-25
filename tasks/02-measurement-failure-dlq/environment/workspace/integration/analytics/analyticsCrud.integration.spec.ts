import { Analytics } from '../client/privateClient/analytics.js';
import { Setting } from '../client/privateClient/settings.js';
import { Customer } from '../client/publicClient/customer.js';
import { AggregationMethod } from '../client/publicClient/dimension.js';
import { Invoice } from '../client/publicClient/invoice.js';
import { Usage } from '../client/publicClient/usage.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
} from '../setupAndTeardown/setup.js';
import { DatetimeUtils } from '../utils/Datetime.js';
import { sleep } from '../utils/utils.js';
import { ANALYTICS_PARAMETERS_INPUT } from './analyticsParameters.integration.input.js';

describe('Analytics CRUD', () => {
    test.concurrent.each(ANALYTICS_PARAMETERS_INPUT)(
        'Get all analytics should be defined given different parameter combinations',
        async (params) => {
            const res = await Setting.update({
                cloudIAM: { iamRoleArn: 'arn:aws:iam::123456789012:role/meteringco-read-only' },
            });
            sleep(2000);
            const response = await Analytics.getAll(params);
            expect(response).toEqual(expect.any(Array));
        }
    );

    test.concurrent.each(ANALYTICS_PARAMETERS_INPUT)(
        'Per Customer Contribution should handle different parameter combinations',
        async (params) => {
            const dimension = await setupDimensionRequest(null, AggregationMethod.Count);
            const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
            const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
            const res = await Setting.update({
                cloudIAM: { iamRoleArn: 'arn:aws:iam::123456789012:role/meteringco-read-only' },
            });
            sleep(2000);
            const analyticsResponse = await Analytics.getAll({ ...params, customerId: customer.customerId });
            expect(analyticsResponse).toEqual(expect.any(Array));
        }
    );

    test('Should handle EUR revenue calculations', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
            paymentChannelOptions: { stripeCustomerId: null },
            currency: 'EUR',
        });
        await sleep(1500);
        // Usage input
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        const oneHourAgo = new Date(new Date().getTime() - 1000 * 60 * 60);
        const usage = new Usage();
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: oneHourAgo,
            end: new Date(),
        });
        const storedInvoice = await Invoice.get(invoice.invoiceId);
        const requestedCustomer = await customer.get();
        expect(requestedCustomer.invoices.length).toEqual(1);
        expect(storedInvoice.invoiceId).toBeDefined();
        expect(
            6 >= parseFloat(storedInvoice.totalAmountWithoutTax) && parseFloat(storedInvoice.totalAmountWithoutTax) >= 2
        ).toBeTruthy();
        expect(storedInvoice.lineItems.length).toEqual(1);
        expect(storedInvoice.currency).toEqual('EUR');
        await Invoice.update({ invoiceStatus: 'Open', invoiceId: invoice.invoiceId });

        const analyticsResponse = await Analytics.getAll({
            start: DatetimeUtils.firstDayOfMonth().toISOString(),
            end: DatetimeUtils.lastDayOfMonth().toISOString(),
            metric: 'revenue',
            customerId: customer.customerId,
        });
        expect(analyticsResponse).toEqual(expect.any(Array));
        // EUR should be converted to USD, and roughly should be between a dollar.
        expect(5 >= analyticsResponse[0].revenue && analyticsResponse[0].revenue >= 3).toBeTruthy();
    });

    test('Two mixed currencies should appear together in the invoice', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
            paymentChannelOptions: { stripeCustomerId: null },
            currency: 'EUR',
        });
        await sleep(1500);
        // Usage input
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        const oneHourAgo = new Date(new Date().getTime() - 1000 * 60 * 60);
        const usage = new Usage();
        for (const value of usageInput) {
            await sleep(1000);
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        const invoiceEur = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: oneHourAgo,
            end: new Date(),
        });
        const storedInvoiceEur = await Invoice.get(invoiceEur.invoiceId, 'true');
        const requestedCustomer = await customer.get();
        expect(requestedCustomer.invoices.length).toEqual(1);
        expect(storedInvoiceEur.invoiceId).toBeDefined();
        expect(
            6 >= parseFloat(storedInvoiceEur.totalAmountWithoutTax) &&
                parseFloat(storedInvoiceEur.totalAmountWithoutTax) >= 2
        ).toBeTruthy();
        expect(storedInvoiceEur.lineItems.length).toEqual(1);
        expect(storedInvoiceEur.currency).toEqual('EUR');
        await Invoice.update({ invoiceStatus: 'Open', invoiceId: invoiceEur.invoiceId });
        await customer.update({ currency: 'USD' });
        sleep(3500);
        const invoiceUsd = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: oneHourAgo,
            end: new Date(),
        });
        const storedInvoice = await Invoice.get(invoiceUsd.invoiceId, 'true');
        const requestedCustomerAfterInvoice2 = await customer.get();
        expect(requestedCustomerAfterInvoice2.invoices.length).toEqual(2);
        expect(storedInvoice.invoiceId).toBeDefined();
        expect(storedInvoice.totalAmountWithoutTax).toEqual(4);
        expect(storedInvoice.lineItems.length).toEqual(1);
        expect(storedInvoice.currency).toEqual('USD');

        await Invoice.update({ invoiceStatus: 'Open', invoiceId: invoiceUsd.invoiceId });
        console.log(JSON.stringify(storedInvoice, null, 2));
        const analyticsResponse = await Analytics.getAll({
            start: DatetimeUtils.firstDayOfMonth().toISOString(),
            end: DatetimeUtils.lastDayOfMonth().toISOString(),
            metric: 'revenue',
            customerId: customer.customerId,
        });
        expect(analyticsResponse).toEqual(expect.any(Array));
        // EUR should be converted to USD, and roughly should be between a dollar.
        expect(9 >= analyticsResponse[0].revenue && analyticsResponse[0].revenue >= 7).toBeTruthy();
    });
});
