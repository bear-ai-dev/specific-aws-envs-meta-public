import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
    setupSimpleService,
} from '../setupAndTeardown/setup.js';
import { Usage } from '../client/publicClient/usage.js';
import { AggregationInterval, AggregationMethod, Dimension, Rounding } from '../client/publicClient/dimension.js';
import { input } from './dimensionAggregation.integration.input.js';
import { sleep } from '../utils/utils.js';

describe('Dimension aggregation', () => {
    test.concurrent.each(input)(
        'Validate $aggregationMethod aggregation with input $usageInput and with $usageIncrement increment rounded to $rounding',
        async ({ aggregationMethod, usageInput, aggregatedValue, usageIncrement, rounding }) => {
            const dimension = await setupDimensionRequest(
                null,
                aggregationMethod,
                undefined,
                rounding,
                usageIncrement?.toString()
            );
            await sleep(1000 * 5);
            const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
            await sleep(1000 * 5);
            const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });
            await sleep(1000 * 5);

            const usage = new Usage();

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
            expect(testValue).toBe(aggregatedValue);
        }
    );
});
