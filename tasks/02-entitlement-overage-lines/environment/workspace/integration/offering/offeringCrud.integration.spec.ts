import { Customer } from '../client/publicClient/customer.js';
import { AggregationMethod } from '../client/publicClient/dimension.js';
import { Offering, UsageBasedOffering } from '../client/publicClient/offering.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleSubscriptionOffering,
    setupSimpleUsageBasedOffering,
    setupSubscriptionFreeTrial,
    setupUsageBasedFreeTrial,
} from '../setupAndTeardown/setup.js';
import { DatetimeUtils } from '../utils/Datetime.js';
import { sleep } from '../utils/utils.js';

describe('Offering CRUD', () => {
    test('Get all Offering', async () => {
        const offeringClient = new UsageBasedOffering();
        const response = await offeringClient.getAll();
        expect(response).toEqual(expect.any(Array));
    });

    test('Update Offering Dimension base case', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1500);
        const offering = await setupSimpleUsageBasedOffering();
        await sleep(1500);
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation = await offering.get();
        expect(fullOfferingInformation?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
    });
    test('Update Offering Dimension should allow dimensions to be deleted after they are removed', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1500);
        const offering = await setupSimpleUsageBasedOffering();
        await sleep(1500);
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation = await offering.get();
        expect(fullOfferingInformation?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
        await offering.update({ dimensionIds: [] });
        await sleep(1500);
        const fullOfferingInformation2 = await offering.get();
        expect(fullOfferingInformation2?.dimensions).toEqual([]);
        await dimension.delete();
        await sleep(1500);
    });
    test('Subscription price should only support 8 digits of precision', async () => {
        await expect(setupSimpleSubscriptionOffering({ subscriptionPrice: '0.000000009' })).rejects.toThrow();
        await expect(setupSimpleSubscriptionOffering({ subscriptionPrice: '0.00000009' })).resolves.toEqual(
            expect.objectContaining({ offeringId: expect.any(String) })
        );
    });

    test('Update Offering Dimension removal and re adding', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1500);
        const offering = await setupSimpleUsageBasedOffering();
        await sleep(1500);
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation = await offering.get();
        expect(fullOfferingInformation?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
        await offering.update({ dimensionIds: [] });
        await sleep(1500);
        const fullOfferingInformation2 = await offering.get();
        expect(fullOfferingInformation2?.dimensions).toEqual([]);
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation3 = await offering.get();
        expect(fullOfferingInformation3?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
    });
    test('Multiple Dimensions added and removed', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const dimension2 = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1500);
        const offering = await setupSimpleUsageBasedOffering();
        await sleep(1500);
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation = await offering.get();
        expect(fullOfferingInformation?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
        await offering.update({ dimensionIds: [] });
        await sleep(1500);
        const fullOfferingInformation2 = await offering.get();
        expect(fullOfferingInformation2?.dimensions).toEqual([]);
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation3 = await offering.get();
        expect(fullOfferingInformation3?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
        await offering.update({ dimensionIds: [dimension.dimensionId, dimension2.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation4 = await offering.get();
        expect(fullOfferingInformation4?.dimensions).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ dimensionId: dimension.dimensionId }),
                expect.objectContaining({ dimensionId: dimension2.dimensionId }),
            ])
        );
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation5 = await offering.get();
        expect(fullOfferingInformation5?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
    });

    test('Updates which dont include dimensionId arrays should not touch the dimensionId array', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await sleep(1500);
        const offering = await setupSimpleUsageBasedOffering();
        await sleep(1500);
        await offering.update({ dimensionIds: [dimension.dimensionId] });
        await sleep(1500);
        const fullOfferingInformation = await offering.get();
        expect(fullOfferingInformation?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
        await offering.update({ offeringName: 'new name' });
        await sleep(1500);
        const fullOfferingInformation2 = await offering.get();
        expect(fullOfferingInformation2?.dimensions).toEqual(
            expect.arrayContaining([expect.objectContaining({ dimensionId: dimension.dimensionId })])
        );
        expect(fullOfferingInformation2?.offeringName).toEqual('new name');
    });
    test('Offerings should not delete if a customer is using one', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering.offeringId);

        await expect(offering.delete()).rejects.toThrowError();
    });
    test('Offerings should not support EUR currency', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        await expect(setupSimpleUsageBasedOffering([dimension.dimensionId], 'EUR')).rejects.toThrowError();
        await expect(setupSimpleUsageBasedOffering([], 'EUR')).rejects.toThrowError();
    });
    test('Offerings should default to USD currency', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering.offeringId);
        expect(fullCustomerInformation?.offering?.currency).toEqual('USD');
        const offeringInformation = await Offering.getById(offering.offeringId as string);
        expect(offeringInformation?.currency).toEqual('USD');
    });
    test('FreeTrial must be a number string', async () => {
        await expect(setupSubscriptionFreeTrial({ freeTrialLength: 'abc' })).rejects.toThrowError();
        await expect(setupUsageBasedFreeTrial({ freeTrialLength: 'abc' })).rejects.toThrowError();
    });
    test('Update offering should not support free trial length and credit', async () => {
        await expect(
            setupSubscriptionFreeTrial({ freeTrialLength: '10', prepaidCredit: '100' })
        ).rejects.toThrowError();
        const freeTrialOnLength = await setupUsageBasedFreeTrial({ freeTrialLength: '10' });
        await expect(freeTrialOnLength.update({ prepaidCredit: '100' })).rejects.toThrowError();
    });

    test('Offerings should delete if a customer has switched to a different one', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering1 = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const offering2 = await setupSimpleUsageBasedOffering();
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering1.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering1.offeringId);
        const oldOfferingId = fullCustomerInformation?.offering?.offeringId as string;
        await customer.update({ offeringId: offering2.offeringId });
        await sleep(1500);
        await offering1.delete();
        await sleep(1500);
        const fullCustomerInformation2 = (await customer.get()) as Customer;
        expect(fullCustomerInformation2?.offering?.offeringId).toEqual(offering2.offeringId);
        await expect(Offering.getById(oldOfferingId)).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
        expect(fullCustomerInformation2?.invoices?.length).toEqual(1);
    });
    test('Removing an offering from a customer should create an invoice', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering1 = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering1.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering1.offeringId);
        expect(fullCustomerInformation?.invoices?.length).toEqual(0);
        console.log(fullCustomerInformation?.invoices);
        await customer.update({ offeringId: null });
        await sleep(1500);
        const fullCustomerInformation2 = (await customer.get()) as Customer;
        expect(fullCustomerInformation2?.offering?.offeringId).not.toBeDefined();
        console.log(fullCustomerInformation2?.invoices);
        expect(fullCustomerInformation2?.invoices?.length).toEqual(1);
    });
    test('Offerings should delete if a customer has been removed from the offering and then the customer is deleted', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({
            offeringId: offering.offeringId,
        });
        await sleep(1500);
        const fullCustomerInformation = (await customer.get()) as Customer;
        expect(customer.customerId).toStrictEqual(expect.any(String));
        expect(fullCustomerInformation?.offering?.offeringId).toEqual(offering.offeringId);
        const oldOfferingId = fullCustomerInformation?.offering?.offeringId as string;
        await customer.update({ offeringId: null });
        await sleep(1500);
        await customer.delete();
        await sleep(1500);
        await offering.delete();
        await sleep(1500);
        await expect(Offering.getById(oldOfferingId)).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
    });
    test('Usage Offerings delete base case', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const offeringId = offering.offeringId?.split('').join('') as string;
        await sleep(1500);
        await offering.delete();
        await sleep(1500);
        await expect(Offering.getById(offeringId)).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
    });
    test('Offering updates to EUR should not work', async () => {
        const offering1 = await setupSimpleSubscriptionOffering();
        const offeringResponse = await offering1.get();
        expect(offeringResponse.currency).toBe('USD');
        await expect(offering1.update({ currency: 'EUR' })).rejects.toThrowError();
        const offeringResponse2 = await offering1.get();
        expect(offeringResponse2.currency).toBe('USD');
    });
    test('Subscription Offering delete base case', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleSubscriptionOffering({
            dimensionIds: [dimension.dimensionId],
            subscriptionPrice: 10,
        });
        const offeringId = offering.offeringId?.split('').join('') as string;
        await sleep(1500);
        await offering.delete();
        await sleep(1500);
        await expect(Offering.getById(offeringId)).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
    });
});
