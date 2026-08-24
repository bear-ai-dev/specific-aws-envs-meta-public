import { Scheduler } from '../client/privateClient/scheduler.js';
import { Customer, PaymentChannel, TaxExempt } from '../client/publicClient/customer.js';
import { AggregationMethod } from '../client/publicClient/dimension.js';
import { Address } from '../client/publicClient/init.js';
import { InvoiceStatus } from '../client/publicClient/invoice.js';
import { Usage } from '../client/publicClient/usage.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleSubscriptionOffering,
    setupSimpleUsageBasedOffering,
    setupUsageBasedFreeTrial,
} from '../setupAndTeardown/setup.js';
import { sleep } from '../utils/utils.js';
import { ADDRESS_INPUT } from './customerCrud.integration.input.js';
import { Setting } from '../client/privateClient/settings.js';

describe('Customer CRUD', () => {
    test('Delete Customer should work', async () => {
        const offering = await setupSimpleUsageBasedOffering();
        await sleep(1500);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        await customer.delete();

        try {
            await customer.get();
        } catch (e) {
            expect(e.message).toContain('404');
        }
    });
});

describe('Test customer create', () => {
    test('Create customer with no name', async () => {
        try {
            await setupCustomerWallStrTrading({ customerName: null });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create customer with no email ', async () => {
        try {
            await setupCustomerWallStrTrading({ email: null });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create customer with no payment channel ', async () => {
        try {
            await setupCustomerWallStrTrading({ paymentChannel: null });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create customer with only required fields', async () => {
        const customer = await setupCustomerWallStrTrading({
            taxExempt: null,
            customerVatId: null,
            address: null,
        });
        expect(customer.customerId).not.toBeNull();
        expect(customer.customerId).not.toBeUndefined();
    });

    test.each([TaxExempt.Exempt, TaxExempt.None])('Create customer with tax exempt %s', async (taxExempt) => {
        const customer = await setupCustomerWallStrTrading({
            taxExempt,
        });
        expect(customer.customerId).not.toBeNull();
        expect(customer.customerId).not.toBeUndefined();
    });

    test('Create customer with invalid tax exempt', async () => {
        try {
            await setupCustomerWallStrTrading({
                // @ts-ignore
                taxExempt: 'taxExempt',
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create a simple customer', async () => {
        const customer = await setupCustomerWallStrTrading();
        expect(customer.customerId).not.toBeNull();
        expect(customer.customerId).not.toBeUndefined();
    });

    test('Create a customer with upper case country code', async () => {
        try {
            await setupCustomerWallStrTrading({
                address: new Address('US', '94105', 'San Francisco', 'CA', '1 Market St', ''),
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create a customer with three letter country code', async () => {
        try {
            await setupCustomerWallStrTrading({
                address: new Address('chn', '94105', 'San Francisco', 'CA', '1 Market St', ''),
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }

        try {
            await setupCustomerWallStrTrading({
                address: new Address('CHN', '94105', 'San Francisco', 'CA', '1 Market St', ''),
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create a customer with full country name', async () => {
        try {
            await setupCustomerWallStrTrading({
                address: new Address('United States', '94105', 'San Francisco', 'CA', '1 Market St', ''),
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create a customer with full state name', async () => {
        try {
            await setupCustomerWallStrTrading({
                address: new Address('United States', '94105', 'San Francisco', 'California', '1 Market St', ''),
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create a customer with upper case state code', async () => {
        const customer = await setupCustomerWallStrTrading({
            address: new Address('us', '94105', 'San Francisco', 'CA', '1 Market St', ''),
        });
        expect(customer.customerId).not.toBeNull();
        expect(customer.customerId).not.toBeUndefined();
    });

    test('Create a customer with country and state mismatch', async () => {
        try {
            await setupCustomerWallStrTrading({
                address: new Address('us', '94105', 'San Francisco', 'London', '1 Market St', ''),
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
        }
    });

    test('Create a customer with wrong zipcode', async () => {
        const customer = await setupCustomerWallStrTrading({
            address: new Address('us', '941005', 'San Francisco', 'CA', '1 Market St', ''),
        });
        expect(customer.customerId).not.toBeNull();
        expect(customer.customerId).not.toBeUndefined();
    });

    test('Create 50 stripe customers and run get all should work', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        let counter;
        for (counter = 0; counter < 50; counter++) {
            await setupCustomerWallStrTrading({
                offeringId: offering.offeringId,
            });
            await sleep(1000);
        }
        const customerClient = new Customer();
        const response = await customerClient.getAll();
        expect(response).toEqual(expect.any(Array));
    });

    test('Create customer with an improper offeringId should fail', async () => {
        try {
            await setupCustomerWallStrTrading({
                offeringId: '123',
            });
        } catch (e) {
            expect(e.statusCode).toBe(400);
            expect(e.message[0]).toEqual(expect.stringContaining('offeringId'));
        }
    });
    test('Create customer with a valid offeringId should pass', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering.offeringId);
    });
    test('Customer and offering without any currency should return USD', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.currency).toEqual('USD');
    });
    test('Create customer with a valid offeringId should create a billing schedule', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1000 * 1.5);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering.offeringId);
        const [{ id: schedulerId }] = await Scheduler.get(customer.customerId);
        expect(schedulerId).toEqual(expect.anything());
    });
    test('Customer subscription offering Update should create an invoice for the usage if the offering is removed', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleSubscriptionOffering({
            dimensionIds: [dimension.dimensionId],
            subscriptionPrice: 10,
        });
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1000 * 1.5);
        const usage = new Usage();
        const usageInput = ['1'];
        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 1.5);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering.offeringId);
        await customer.update({ offeringId: null });
        await sleep(1000 * 1.5);
        const fullCustomerInformation2 = (await customer.get()) as Customer;
        expect(fullCustomerInformation2?.offering?.offeringId).not.toBeDefined();
        expect(fullCustomerInformation2?.invoices?.length).toEqual(2);
        fullCustomerInformation2?.invoices?.forEach((invoice) => {
            expect(invoice.invoiceStatus).toEqual(InvoiceStatus.DRAFT);
            expect(invoice.lineItems.length).toEqual(1);
        });
    });

    test('Update Customer should set a future freeTrialEnd date if the new offering has a freeTrial associated with it', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1000 * 1.5);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering.offeringId);
        const freeTrialOffering = await setupUsageBasedFreeTrial({
            dimensionIds: [dimension.dimensionId] as Array<string>,
            freeTrialLength: '10',
        });
        await customer.update({ offeringId: freeTrialOffering.offeringId });
        await sleep(1000 * 1.5);
        const fullCustomerInformationAfterUpdate = (await customer.get()) as Customer;
        expect(fullCustomerInformationAfterUpdate?.offering?.offeringId).toEqual(freeTrialOffering.offeringId);
        console.log(fullCustomerInformationAfterUpdate?.freeTrialEndDate);
        expect(fullCustomerInformationAfterUpdate?.freeTrialEndDate).toEqual(expect.anything());
    });
    test('Update Customer should set a freeTrialEndDate to now if the new offering does not have a free trial', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);

        const freeTrialOffering = await setupUsageBasedFreeTrial({
            dimensionIds: [dimension.dimensionId] as Array<string>,
            freeTrialLength: '10',
        });
        const customer = await setupCustomerWallStrTrading({
            offeringId: freeTrialOffering.offeringId,
        });

        await sleep(1000 * 1.5);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(freeTrialOffering.offeringId);
        expect(fullCustomerInformation?.freeTrialEndDate).toEqual(expect.anything());

        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await customer.update({ offeringId: offering.offeringId });
        await sleep(1000 * 1.5);
        const fullCustomerInformationAfterUpdate = (await customer.get()) as Customer;
        expect(fullCustomerInformationAfterUpdate?.offering?.offeringId).toEqual(offering.offeringId);
        console.log(JSON.stringify(fullCustomerInformationAfterUpdate), 'free trial end date');
        const diffInSeconds = Math.abs(
            (new Date(fullCustomerInformationAfterUpdate?.freeTrialEndDate as string).getTime() -
                new Date().getTime()) /
                1000,
        );

        expect(diffInSeconds).toBeLessThan(10);
    });
    test('Create 50 stripe customers and run get all should work', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        let counter;
        for (counter = 0; counter < 50; counter++) {
            await setupCustomerWallStrTrading({
                offeringId: offering.offeringId,
                paymentChannel: 'Stripe',
            });
            sleep(2000);
        }
        const customerClient = new Customer();
        const response = await customerClient.getAll();
        expect(response).toEqual(expect.any(Array));
    });
    test('Updating a customers currency should not change free trial end date', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);

        const freeTrialOffering = await setupUsageBasedFreeTrial({
            dimensionIds: [dimension.dimensionId] as Array<string>,
            freeTrialLength: '10',
        });
        const customer = await setupCustomerWallStrTrading({
            offeringId: freeTrialOffering.offeringId,
        });

        await sleep(1000 * 1.5);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(freeTrialOffering.offeringId);
        expect(fullCustomerInformation?.freeTrialEndDate).toEqual(expect.anything());

        await customer.update({ currency: 'EUR' });
        await sleep(1000 * 1.5);
        const fullCustomerInformationAfterUpdate = (await customer.get()) as Customer;
        expect(fullCustomerInformationAfterUpdate?.offering?.offeringId).toEqual(freeTrialOffering.offeringId);
        expect(fullCustomerInformationAfterUpdate?.freeTrialEndDate).toEqual(fullCustomerInformation.freeTrialEndDate);
    });
    test('Update Customer should not set a free trial if the neither offering has one', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering1 = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const offering2 = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering1.offeringId,
        });

        await sleep(1000 * 1.5);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering1.offeringId);
        expect(fullCustomerInformation?.freeTrialEndDate).not.toBeDefined();
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1000 * 1.5);
        const fullCustomerInformationAfterUpdate = (await customer.get()) as Customer;
        expect(fullCustomerInformationAfterUpdate?.offering?.offeringId).toEqual(offering2.offeringId);
        expect(fullCustomerInformationAfterUpdate?.freeTrialEndDate).not.toBeDefined();
    });
    test.each(ADDRESS_INPUT)('Create a customer with address %s', async (address) => {
        const customer = await setupCustomerWallStrTrading({
            address: new Address(
                address.countryCode,
                address.postalCode,
                address.city,
                address.state,
                address.street,
                address.street2,
            ),
        });
        expect(customer.customerId).not.toBeNull();
        expect(customer.customerId).not.toBeUndefined();
    });
});

describe('Create/update customer with Stripe', () => {
    xtest('Create a customer without existing Stripe customer', async () => {
        await Setting.update({ stripeAccountId: process.env.STRIPE_ACCOUNT_ID, stripeConnected: 'true' });
        const customer = await setupCustomerWallStrTrading({ paymentChannelOptions: null });
        expect(customer.portalUrl).toContain('https://billing');
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(fullCustomerInformation?.paymentChannelOptions?.stripeCustomerId).toContain('cus_');
    });

    xtest('Create a customer without existing Stripe customer, but Stripe not connected', async () => {
        await Setting.update({ stripeAccountId: null, stripeConnected: 'false' });
        try {
            await setupCustomerWallStrTrading({ paymentChannelOptions: null });
        } catch (e) {
            expect(e.message).toContain(
                'Failed to create customer. Must enable Stripe Connect in order to automatically add customer to Stripe.',
            );
        }
    });

    test('Update a customer with Stripe customer to be crated, but Stripe not connected', async () => {
        await Setting.update({ stripeAccountId: null, stripeConnected: 'false' });
        const customer = await setupCustomerWallStrTrading({
            paymentChannel: PaymentChannel.Manual,
            paymentChannelOptions: null,
        });
        let fullCustomerInformation = (await customer.get()) as Customer;
        expect(fullCustomerInformation?.paymentChannel).toBe(PaymentChannel.Manual);
        expect(fullCustomerInformation?.paymentChannelOptions?.stripeCustomerId).toBeUndefined();

        try {
            await customer.update({ paymentChannel: PaymentChannel.Stripe });
        } catch (e) {
            expect(e.message).toContain(
                'Failed to update customer. Must enable Stripe Connect in order to automatically add customer to Stripe.',
            );
        }
    });

    test('Update a customer with Stripe customer created', async () => {
        await Setting.update({ stripeAccountId: process.env.STRIPE_ACCOUNT_ID, stripeConnected: 'true' });
        const customer = await setupCustomerWallStrTrading({
            paymentChannel: PaymentChannel.Manual,
            paymentChannelOptions: null,
        });
        let fullCustomerInformation = (await customer.get()) as Customer;
        expect(fullCustomerInformation?.paymentChannel).toBe(PaymentChannel.Manual);
        expect(fullCustomerInformation?.paymentChannelOptions?.stripeCustomerId).toBeUndefined();

        await customer.update({ paymentChannel: PaymentChannel.Stripe });
        expect(customer.portalUrl).toContain('https://billing');
        fullCustomerInformation = (await customer.get()) as Customer;
        expect(fullCustomerInformation?.paymentChannelOptions?.stripeCustomerId).toContain('cus_');
    });
});

describe('Customer JWT', () => {
    test('SaaS business should be able to get a JWT for a SaaS customer', async () => {
        const customer = await setupCustomerWallStrTrading();
        await customer.getJWT();
        expect(customer.customerAccessToken).toEqual(expect.stringContaining(''));
    });
    test('SaaS customer should be able to use JWT to access their dashboard usage', async () => {
        const customer = await setupCustomerWallStrTrading();
        await customer.getJWT();
        const usage = await customer.getSaaScustomerUsage();
        expect(usage.data).toEqual([]);
    });
    test('SaaS customer should be able to see usage', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Max);
        await sleep(3 * 1000);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        await sleep(3 * 1000);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
        await sleep(3 * 1000);
        await customer.getJWT();

        const usage = new Usage();

        for (const value of ['1', '2', '3']) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
            });
        }
        await sleep(1000 * 10);
        const customerUsageResponse = await customer.getSaaScustomerUsage();
        expect(customerUsageResponse.data.length).toEqual(1);
        expect(customerUsageResponse.data[0].dimensionId).toEqual(dimension.dimensionId);
        expect(customerUsageResponse.data[0].usage).toEqual(
            expect.arrayContaining([
                { value: expect.any(String), startTime: expect.any(String), endTime: expect.any(String) },
            ]),
        );
        const usageArray = customerUsageResponse.data[0].usage as Array<{
            value: string;
            startTime: string;
            endTime: string;
        }>;
        expect(usageArray.find(({ value }) => value === '3')).toEqual(expect.anything());
    });
    test('Changing the JWT should result in UnAuthorized response', async () => {
        const customer = await setupCustomerWallStrTrading();
        await customer.getJWT();
        customer.customerAccessToken = `${customer.customerAccessToken}${(Math.random() + 1)
            .toString(36)
            .substring(7)}`;

        try {
            await customer.getSaaScustomerUsage();
        } catch (e) {
            expect(e.statusCode).toBe(401);
        }
    });
});
