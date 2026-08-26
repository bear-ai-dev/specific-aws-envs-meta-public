import { BILLING_AGGREGATION_INPUT } from '../billing/billing.integration.input.js';
import { Invoice, InvoiceStatus } from '../client/publicClient/invoice.js';
import { AggregationMethod, Rounding } from '../client/publicClient/dimension.js';
import { Usage } from '../client/publicClient/usage.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
    setupUsageBasedFreeTrial,
} from '../setupAndTeardown/setup.js';
import { sleep } from '../utils/utils.js';
import { Setting, TaxCalculationType } from '../client/privateClient/settings.js';
import { Address } from '../client/publicClient/init.js';
import { VALID_INVOICE_TIME_PERIOD } from './invoice.integration.input.js';
import { DatetimeUtils } from '../utils/Datetime.js';
import { User } from '../client/privateClient/user.js';

describe('Invoices', () => {
    // TODO: use Test.each.concurrent to run this test in parallel with data driven inputs like dimensionAggregation tests
    test('should be able to generate offcycle invoices correctly', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        expect(invoice.invoiceId).toBeDefined();
        expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
        expect(invoice.totalAmountWithoutTax).toEqual(4);
        expect(invoice.lineItems.length).toEqual(1);
        expect(invoice.lineItems[0]).toEqual(
            expect.objectContaining({ name: 'Request - Simple Offering', quantity: 10, unitCost: 0.4 })
        );
        expect(invoice.payments).toEqual([]);
        expect(invoice.refunds).toEqual([]);
    });

    test('Should return the default currency', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);

        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
        });
        expect(invoice.currency).toEqual(expect.anything());
    });

    test('changing invoice status shouldnt change lineItems', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1500);
        const offering = await setupUsageBasedFreeTrial({
            dimensionIds: [dimension.dimensionId],
            freeTrialLength: '15',
        });
        await sleep(1500);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
            paymentChannelOptions: { stripeCustomerId: null } as any,
        });
        await sleep(1500);
        const usage = new Usage();
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = (await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        })) as Invoice;
        expect(invoice.invoiceId).toBeDefined();
        expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
        expect(invoice.totalAmountWithoutTax).toEqual(4);
        expect(invoice.lineItems.length).toEqual(1);
        expect(invoice.lineItems[0]).toEqual(
            expect.objectContaining({ name: 'Request - Free Trial Usage Offering', quantity: 10, unitCost: 0.4 })
        );
        await Invoice.update({ invoiceStatus: 'Open', invoiceId: invoice.invoiceId });
        await sleep(1000 * 2);
        const updatedInvoice = await Invoice.get(invoice.invoiceId);
        expect(updatedInvoice.invoiceStatus).toEqual('Open');
        expect(updatedInvoice.lineItems.length).toEqual(1);
        expect(updatedInvoice.lineItems[0]).toEqual(
            expect.objectContaining({ name: 'Request - Free Trial Usage Offering', quantity: 10, unitCost: 0.4 })
        );
    });
    test('off cycle invoices should not care about free trial', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupUsageBasedFreeTrial({
            dimensionIds: [dimension.dimensionId],
            freeTrialLength: '15',
        });
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        expect(invoice.invoiceId).toBeDefined();
        expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
        expect(invoice.totalAmountWithoutTax).toEqual(4);
        expect(invoice.lineItems.length).toEqual(1);
        expect(invoice.lineItems[0]).toEqual(
            expect.objectContaining({ name: 'Request - Free Trial Usage Offering', quantity: 10, unitCost: 0.4 })
        );
    });
    test('should properly scale data units for dimensions', async () => {
        const dimension = await setupDimensionRequest(
            null,
            AggregationMethod.Sum,
            'Data Ingestioned',
            Rounding.Ceiling,
            '1073741824',
            'byte',
            'data'
        );
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['1073741824']; // 1 giagbyte
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        expect(invoice.invoiceId).toBeDefined();
        expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
        expect(invoice.totalAmountWithoutTax).toEqual(0.4);
        expect(invoice.lineItems.length).toEqual(1);
        expect(invoice.lineItems[0]).toEqual(
            expect.objectContaining({
                name: 'Data Ingestioned - Gigabyte - Simple Offering',
                quantity: 1,
                unitCost: 0.4,
            })
        );
    });
    test('Automatic units should not be calculated for varying usage increments on data', async () => {
        const dimension = await setupDimensionRequest(
            null,
            AggregationMethod.Sum,
            'Data Ingestioned',
            Rounding.Ceiling,
            '657',
            'byte',
            'data'
        );
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['1073741824'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        expect(invoice.invoiceId).toBeDefined();
        expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
        expect(invoice.lineItems.length).toEqual(1);
        expect(invoice.lineItems[0]).toEqual(
            expect.objectContaining({
                name: 'Data Ingestioned - Simple Offering',
                unitCost: 0.4,
            })
        );
    });

    test('should properly scale time based units for dimensions', async () => {
        const dimension = await setupDimensionRequest(
            null,
            AggregationMethod.Sum,
            'Pod Uptime',
            Rounding.Ceiling,
            '24',
            'hour',
            'time'
        );
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['86'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        expect(invoice.invoiceId).toBeDefined();
        expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
        expect(invoice.totalAmountWithoutTax).toEqual(1.6);
        expect(invoice.lineItems.length).toEqual(1);
        expect(invoice.lineItems[0]).toEqual(
            expect.objectContaining({
                name: 'Pod Uptime - Day - Simple Offering',
                quantity: 4,
                unitCost: 0.4,
            })
        );
    });
    test('Should use customer set currency on invoices', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId], 'USD');
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
        for (var i = 0; i < usageInput.length; i++) {
            const value = usageInput[i];
            await usage.create({
                timestamp: new Date(new Date().getTime() - 1000 * i * 5).toISOString(),
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
        await sleep(1500);
        const storedInvoice = await Invoice.get(invoice.invoiceId);
        expect(storedInvoice.currency).toEqual('EUR');
    });
    test('Should default USD when no currency is set', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
            paymentChannelOptions: { stripeCustomerId: null },
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
        expect(storedInvoice.currency).toEqual('USD');
    });
    test('Should use offering currency when no currency is set on customer', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId], 'USD');
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
            paymentChannelOptions: { stripeCustomerId: null },
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
        expect(storedInvoice.totalAmountWithoutTax).toEqual(4);
        expect(storedInvoice.lineItems.length).toEqual(1);
        expect(storedInvoice.currency).toEqual('USD');
    });

    xtest('Should not update invoice status if there is no stripe accountId', async () => {
        // Create offering
        await sleep(1000);
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1000);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(1000);
        // Create a customer with a stripe customer id
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            // eslint-disable-next-line
            // @ts-ignore
            paymentChannelOptions: { stripeCustomerId: process.env.STRIPE_CLIENT_ACCOUNT_ID },
        });
        await sleep(1000);
        // Create usage
        const usage = new Usage();
        await usage.create({
            dimensionId: dimension.dimensionId,
            recordValue: '10',
            customerId: customer.customerId,
        });
        await sleep(1000);
        // Generate invoice
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60),
            end: new Date(),
        });
        await sleep(1000);
        // Update the status of the invoice to open
        await Invoice.update({ invoiceId: invoice.invoiceId, invoiceStatus: InvoiceStatus.OPEN });
        await sleep(3000);
        // Get the invoice
        const storedInvoice = await Invoice.get(invoice.invoiceId);
        // Check to see if the invoice status has been marked as Paid
        expect(storedInvoice.invoiceStatus).toEqual(InvoiceStatus.OPEN);
    });
    test('Should not mark an invoice as paid if there is an issue with payouts on stripe', async () => {
        // Set the settings values for stripe account Id
        await Setting.update({ stripeAccountId: process.env.STRIPE_ACCOUNT_ID, stripeConnected: 'true' });
        // Create offering
        await sleep(1000);
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1000);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(1000);
        // Create a customer with a stripe customer id
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            // eslint-disable-next-line
            // @ts-ignore
            paymentChannelOptions: { stripeCustomerId: process.env.STRIPE_CLIENT_ACCOUNT_ID_NO_PAYOUT },
        });
        await sleep(1000);
        // Create usage
        const usage = new Usage();
        await usage.create({
            dimensionId: dimension.dimensionId,
            recordValue: '10',
            customerId: customer.customerId,
        });
        await sleep(1000);
        // Generate invoice
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60),
            end: new Date(),
        });
        await sleep(1000);
        // Update the status of the invoice to open
        await Invoice.update({ invoiceId: invoice.invoiceId, invoiceStatus: InvoiceStatus.OPEN });
        await sleep(3000);
        // Get the invoice
        const storedInvoice = await Invoice.get(invoice.invoiceId);
        // Check to see if the invoice status has been marked as Open
        expect(storedInvoice.invoiceStatus).toEqual(InvoiceStatus.OPEN);
    });
    test('Should mark an invoice as paid if sucessfully used stripe', async () => {
        // Set the settings values for stripe account Id
        await Setting.update({ stripeAccountId: process.env.STRIPE_ACCOUNT_ID, stripeConnected: 'true' });
        await User.setSandBoxMode(true);
        // Create offering
        await sleep(1000);
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1000);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(1000);
        // Create a customer with a stripe customer id
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            // eslint-disable-next-line
            // @ts-ignore
            paymentChannelOptions: { stripeCustomerId: process.env.STRIPE_CLIENT_ACCOUNT_ID },
        });
        await sleep(1000);
        // Create usage
        const usage = new Usage();
        await usage.create({
            dimensionId: dimension.dimensionId,
            recordValue: '10',
            customerId: customer.customerId,
        });
        await sleep(1000);
        // Generate invoice
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60),
            end: new Date(),
        });
        await sleep(1000);
        // Update the status of the invoice to open
        await Invoice.update({ invoiceId: invoice.invoiceId, invoiceStatus: InvoiceStatus.OPEN });
        await sleep(3000);
        // Get the invoice
        const storedInvoice = await Invoice.get(invoice.invoiceId);
        // Check to see if the invoice status has been marked as Open
        expect(storedInvoice.invoiceStatus).toEqual(InvoiceStatus.PAID);
    });
    xtest('Should contain tax if correctly setup', async () => {
        const address = new Address('uk', 'W1J 8AJ', 'London', 'London', '1 Downing Street', '');
        await Setting.update({
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
            taxJarApiKey: '235df85140cb15541f1e6d2f8c345459',
            city: address.city,
            state: address.state,
            country: address.countryCode,
            postalCode: address.postalCode,
            addressLine1: address.streetLineOne,
        });
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            address: new Address('us', '14522', 'NY', 'Palmyra', '259 Fayette St', ''),
        });

        const usage = new Usage();
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        console.log(JSON.stringify(invoice));
        expect(invoice.invoiceId).toBeDefined();
        expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
        expect(invoice.totalAmountWithoutTax).toEqual(4);
        expect(invoice.lineItems.length).toEqual(1);
        expect(invoice.lineItems[0]).toEqual(
            expect.objectContaining({ name: 'Request - Simple Offering', quantity: 10, unitCost: 0.4 })
        );
        expect(invoice.taxAmount).toEqual(0.32);
    });
});

describe('Generate invoice for different periods of time', () => {
    test.concurrent.each(VALID_INVOICE_TIME_PERIOD)(
        `Generate off-cycle invoice with $start and $end for usage in $usageTime`,
        async ({ start, end, usageTime }) => {
            const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
            const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
            const customer = await setupCustomerWallStrTrading({
                offeringId: offering.offeringId,
                offeringEnrollmentDate: new Date('2019-01-05T00:00:00.000Z').toISOString(),
            });

            const usage = new Usage();
            const usageInput = ['1'];
            for (const value of usageInput) {
                await usage.create({
                    timestamp: usageTime,
                    dimensionId: dimension.dimensionId,
                    recordValue: value,
                    customerId: customer.customerId,
                });
            }
            await sleep(1000 * 2);
            const invoice = await Invoice.generateOffcycleInvoice({
                customerId: customer.customerId,
                invoiceDate: new Date(),
                start,
                end,
                download: 'true',
            });
            expect(invoice.invoiceId).toBeDefined();
            expect(invoice.invoiceUrl).toEqual(expect.stringContaining(`https://`));
            expect(invoice.totalAmountWithoutTax).toEqual(0.4);
            expect(invoice.lineItems.length).toEqual(1);
            expect(invoice.lineItems[0]).toEqual(
                expect.objectContaining({ name: 'Request - Simple Offering', quantity: 1, unitCost: 0.4 })
            );
        }
    );
});

describe('Multiple Dimension Off cycle invoice creation', () => {
    test.concurrent.each(BILLING_AGGREGATION_INPUT)(
        'Off cycle Invoice creation for various dimension combinations',
        async (billingDimensionInformation) => {
            const offering = await setupSimpleUsageBasedOffering();
            const customer = await setupCustomerWallStrTrading();

            const dimensionResultMap = await Promise.all(
                billingDimensionInformation.map(
                    async ({ aggregationMethod, usageInput, aggregatedValue, unitName, usageIncrement }) => {
                        const dimensionName = (Math.random() + 1).toString(36).substring(7);
                        const dimension = await setupDimensionRequest(
                            null,
                            aggregationMethod,
                            dimensionName,
                            undefined,
                            usageIncrement?.toString()
                        );

                        const usage = new Usage();
                        let counter = 0;
                        for (const value of usageInput) {
                            // Should commit usage with a timestamp of 1 second in the past to ensure that the usage is picked up
                            // Each iteration should be one second apart
                            await usage.create({
                                dimensionId: dimension.dimensionId,
                                recordValue: value,
                                customerId: customer.customerId,
                                timestamp: new Date(new Date().getTime() - 1000 * counter++).toISOString(),
                            });
                        }
                        return {
                            dimensionId: dimension.dimensionId,
                            aggregatedValue: aggregatedValue,
                            dimensionName,
                            unitName,
                            consumptionPrice: dimension.consumptionPrice,
                        };
                    }
                )
            );
            const dimensionIds = dimensionResultMap.map(({ dimensionId }) => dimensionId);
            await offering.update({ dimensionIds });
            await customer.update({
                offeringId: offering.offeringId,
                offeringEnrollmentDate: DatetimeUtils.lastYearGivenDate(new Date()).toISOString(),
            });
            await sleep(1000 * 10);
            const customerResponse = await customer.get();
            expect(customerResponse.offeringEnrollmentDate).toBeDefined();
            console.log(customerResponse.offeringEnrollmentDate);
            const invoice = await Invoice.generateOffcycleInvoice({
                customerId: customer.customerId,
                invoiceDate: new Date(),
                start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
                end: new Date(),
                download: 'true',
            });
            expect(invoice.totalAmountWithoutTax).toEqual(
                dimensionResultMap.reduce((acc, { aggregatedValue, consumptionPrice }) => {
                    acc += parseFloat(
                        (parseFloat(aggregatedValue ? aggregatedValue : '0') * parseFloat(consumptionPrice)).toFixed(5)
                    );
                    return parseFloat(acc.toFixed(5));
                }, 0)
            );
            expect(invoice.lineItems.length).toEqual(dimensionResultMap.length);
            invoice.lineItems.forEach((lineItem) => {
                const dimensionResult = dimensionResultMap.find(({ dimensionName, unitName }) => {
                    const a = `${
                        unitName
                            ? dimensionName + ' - ' + unitName + ' - ' + offering.offeringName
                            : dimensionName + ' - ' + offering.offeringName
                    }`;
                    const b = lineItem.name;

                    return a.toLowerCase() === b.toLowerCase();
                });
                expect(dimensionResult).toBeDefined();
                expect(lineItem.unitCost * lineItem.quantity).toEqual(
                    parseFloat(dimensionResult?.aggregatedValue ? dimensionResult?.aggregatedValue : '0') *
                        parseFloat(dimensionResult?.consumptionPrice ? dimensionResult?.consumptionPrice : '0')
                );
            });
        }
    );
});

describe('Invoice CRUD', () => {
    test('Invoice Update to Voided', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
        });

        const usage = new Usage();
        const usageInput = ['1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        await Invoice.update({ invoiceId: invoice.invoiceId, invoiceStatus: InvoiceStatus.VOIDED });
        await sleep(3000);
        const updatedInvoice = await Invoice.get(invoice.invoiceId);
        expect(updatedInvoice.invoiceStatus).toEqual(InvoiceStatus.VOIDED);
    });
    test('Invoice Update to Open', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
        });

        const usage = new Usage();
        const usageInput = ['1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        await Invoice.update({ invoiceId: invoice.invoiceId, invoiceStatus: InvoiceStatus.OPEN });
        await sleep(3000);
        const updatedInvoice = await Invoice.get(invoice.invoiceId);
        expect(updatedInvoice.invoiceStatus).toEqual(InvoiceStatus.OPEN);
    });
    test('Changing Invoice status should not change payment terms', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
            paymentChannel: 'manual',
        });

        const usage = new Usage();
        const usageInput = ['1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 2);
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate: new Date(),
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
            invoicePaymentTerm: '60',
        });
        const currentInvoice = await Invoice.get(invoice.invoiceId);
        expect(currentInvoice.invoiceStatus).toEqual(InvoiceStatus.DRAFT);
        expect(currentInvoice.invoicePaymentTerm).toEqual('60');
        await Invoice.update({ invoiceId: invoice.invoiceId, invoiceStatus: InvoiceStatus.OPEN });
        await sleep(3000);
        const updatedInvoice = await Invoice.get(invoice.invoiceId);
        expect(updatedInvoice.invoiceStatus).toEqual(InvoiceStatus.OPEN);
        expect(updatedInvoice.invoicePaymentTerm).toEqual('60');
        await Invoice.update({ invoiceId: invoice.invoiceId, invoiceStatus: InvoiceStatus.VOIDED });
        await sleep(3000);
        const updatedInvoice2 = await Invoice.get(invoice.invoiceId);
        expect(updatedInvoice2.invoiceStatus).toEqual(InvoiceStatus.VOIDED);
        expect(updatedInvoice2.invoicePaymentTerm).toEqual('60');
    });
    test('Invoice Date should be set to current date when called correctly', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            paymentChannel: 'manual',
            offeringId: offering.offeringId,
        });
        const invoiceDate = new Date();
        const invoice = await Invoice.generateOffcycleInvoice({
            customerId: customer.customerId,
            invoiceDate,
            start: new Date(new Date().getTime() - 1000 * 60 * 60 * 24),
            end: new Date(),
            download: 'true',
        });
        const currentInvoice = await Invoice.get(invoice.invoiceId);
        expect(currentInvoice.invoiceDate).toEqual(invoiceDate.toISOString());
    });
});

