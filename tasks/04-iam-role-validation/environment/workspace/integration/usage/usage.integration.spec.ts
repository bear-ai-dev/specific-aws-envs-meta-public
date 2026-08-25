import { AggregationMethod } from '../client/publicClient/dimension.js';
import { Usage } from '../client/publicClient/usage.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
} from '../setupAndTeardown/setup.js';
import { DatetimeUtils } from '../utils/Datetime.js';
import { sleep } from '../utils/utils.js';
import { input } from './usageDate.integration.input.js';

describe('Usage for customer aggregation', () => {
    test('Timestamps for usage should be respected', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Max);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['10', '5'];
        const yesterday = new Date(new Date().getTime() - 1000 * 60 * 60 * 24).toISOString();
        const oneHourAfterYesterday = new Date(new Date().getTime() - 1000 * 60 * 60 * 23).toISOString();
        const oneHourAgo = new Date(new Date().getTime() - 1000 * 60 * 60).toISOString();
        const today = new Date().toISOString();
        await Promise.all(
            usageInput.map(async (element, index) => {
                await usage.create({
                    dimensionId: dimension.dimensionId,
                    recordValue: element,
                    customerId: customer.customerId,
                    timestamp: index === 0 ? yesterday : oneHourAgo,
                });
            })
        );
        await sleep(1000 * 5);
        const aggregatedUsage = await customer.getUsage(yesterday, oneHourAfterYesterday, 'hour');
        expect(aggregatedUsage[0].usage[0].value).toEqual('10');
        const aggregatedUsage2 = await customer.getUsage(oneHourAgo, today, 'hour');
        expect(aggregatedUsage2[0].usage[0].value).toEqual('5');
    });
    test('Metering usage requests should ignore usage increment and rounding', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum, 'Request', undefined, '100');
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['10', '5'];

        await Promise.all(
            usageInput.map(async (element, index) => {
                const timestamp = new Date(new Date().getTime() + 1000 * 2 * index).toISOString();
                await usage.create({
                    dimensionId: dimension.dimensionId,
                    recordValue: element,
                    customerId: customer.customerId,
                    timestamp,
                });
            })
        );
        await sleep(1000 * 5);
        const aggregatedUsage = await customer.getUsage(
            DatetimeUtils.firstDayOfMonthGivenDate(new Date()).toISOString(),
            DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonthGivenDate(new Date())).toISOString(),
            'month',
            'metering'
        );
        expect(aggregatedUsage[0].usage[0].value).toEqual('15');
    });

    test('Usage before an offering enrollment should be ignored', async () => {
        const dimension = await setupDimensionRequest(null, AggregationMethod.Max);
        const offeringEnrollmentDate = new Date().toISOString();
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId, offeringEnrollmentDate });
        await sleep(1000 * 2);
        const customerBody = await customer.get();
        expect(customerBody.offeringEnrollmentDate).toEqual(offeringEnrollmentDate);

        const usage = new Usage();
        const usageInput = ['10', '5'];
        const yesterday = new Date(new Date().getTime() - 1000 * 60 * 60 * 24).toISOString();
        const oneHourAfterYesterday = new Date(new Date().getTime() - 1000 * 60 * 60 * 23).toISOString();
        const oneHourAgo = new Date(new Date().getTime() - 1000 * 60 * 60).toISOString();
        const today = new Date().toISOString();
        await Promise.all(
            usageInput.map(async (element, index) => {
                await usage.create({
                    dimensionId: dimension.dimensionId,
                    recordValue: element,
                    customerId: customer.customerId,
                    timestamp: index === 0 ? yesterday : oneHourAgo,
                });
            })
        );
        await sleep(1000 * 5);
        const aggregatedUsage = await customer.getUsage(yesterday, oneHourAfterYesterday, 'hour');
        expect(aggregatedUsage[0].usage[0].value).toEqual('0');
        const aggregatedUsage2 = await customer.getUsage(oneHourAgo, today, 'hour');
        expect(aggregatedUsage2[0].usage[0].value).toEqual('0');
    });

    test.concurrent.each(input)(
        'Validate $testName has expected intervals based on $aggregationInterval aggregation',
        async ({ startDate, endDate, testName, aggregationInterval, expectedIntervals }) => {
            const dimension = await setupDimensionRequest(null, AggregationMethod.Max);
            await sleep(1000 * 2);
            const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
            await sleep(1000 * 2);
            const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
            await sleep(1000 * 2);
            const customerUsage = await customer.getUsage(
                startDate.toISOString(),
                endDate.toISOString(),
                aggregationInterval
            );

            expect(customerUsage[0].usage.length).toBe(expectedIntervals);

            customerUsage[0].usage.forEach((element) => {
                expect(element.value).toBe('0');
            });
        }
    );
});
