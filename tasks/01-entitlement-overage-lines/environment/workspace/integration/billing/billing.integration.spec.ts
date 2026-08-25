import { Scheduler } from '../client/privateClient/scheduler.js';
import { AggregationInterval, AggregationMethod, OverageAllowed } from '../client/publicClient/dimension.js';
import { Offering, OfferingType } from '../client/publicClient/offering.js';
import { Usage } from '../client/publicClient/usage.js';
import {
    setupCustomerWallStrTrading,
    setupDimensionRequest,
    setupSimpleUsageBasedOffering,
    setupSubscriptionFreeTrial,
    setupUsageBasedFreeTrial,
} from '../setupAndTeardown/setup.js';
import { sleep } from '../utils/utils.js';
import { BILLING_AGGREGATION_INPUT } from './billing.integration.input.js';
import { FREE_TRIAL_BILLING_INPUT } from './freeTrialBilling.input.js';

describe('Billing', () => {
    test('should generate monthly bills for a customer', async () => {
        // Create a dimension, a offering, and a customer
        const dimension = await setupDimensionRequest(null, AggregationMethod.Sum);
        const offering = await setupSimpleUsageBasedOffering([dimension.dimensionId]);
        const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

        const usage = new Usage();
        const usageInput = ['1', '1', '1', '1', '1', '1', '1', '1', '1', '1'];
        // Put usage in for the month via the usage client for the customer\
        const date = new Date();
        const firstDayOfLastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
        // Create usage for the last month for the customer
        // Increment the date by 1 minute for each usage record
        let timestamp = firstDayOfLastMonth;

        for (const value of usageInput) {
            await usage.create({
                dimensionId: dimension.dimensionId,
                recordValue: value,
                customerId: customer.customerId,
                timestamp: timestamp.toISOString(),
            });
            timestamp = new Date(timestamp.getTime() + 1000 * 60);
        }
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
        await sleep(1000 * 5);
        // Validate the invoice was created
        const customerData = await customer.get();
        expect(customerData.invoices.length).toBe(1);
        expect(customerData.invoices[0].totalAmountWithoutTax).toEqual(4);
        expect(customerData.invoices[0].lineItems[0]).toEqual({
            name: `${dimension.dimensionName} - ${offering.offeringName}`,
            quantity: 10,
            unitCost: parseFloat(dimension.consumptionPrice),
        });
    });

    test.concurrent.each(FREE_TRIAL_BILLING_INPUT)('Free Trial Billing: %j', async (input) => {
        const {
            setup: { dimensions, offering: argumentOffering },
            usage: argumentUsage,
            //@ts-ignore
            billingStartDate,
            //@ts-ignore
            billingEndDate,
            freeTrialEnd,
            expectations: {
                invoiceIssued,
                //@ts-ignore
                total,
                //@ts-ignore
                lineItems,
            },
        } = input;

        // Create a dimension and offering from the input
        const dimensionResults = await Promise.all(
            dimensions.map(async ({ dimensionName, consumptionPrice }) => {
                // Unit name is used for the line item name, and is only used in cases where the usageIncrement is a standard multiple relative to the consumption unit type
                // EG: usageIncrement 1024, consumptionUnit 'bytes', unitName 'kilobytes'
                // In the case of these tests we are not really looking for it, so we set it to undefined for all of them.
                const usageIncrement = '1';
                const consumptionUnit = 'count-based';
                const consumptionType = 'count';
                const dimension = await setupDimensionRequest(
                    null,
                    undefined,
                    dimensionName,
                    undefined,
                    usageIncrement,
                    consumptionUnit,
                    consumptionType,
                    undefined,
                    OverageAllowed.True,
                    consumptionPrice ? consumptionPrice : null
                );
                return dimension;
            })
        );
        const dimensionNameMap = dimensionResults.reduce((acc, dimension) => {
            acc[dimension.dimensionName] = dimension;
            return acc;
        }, {});
        const dimensionIds = dimensionResults.map(({ dimensionId }) => dimensionId);
        // Attach the offering to the customer
        let offering: Offering;
        if (argumentOffering.offeringType === OfferingType.UsageBased) {
            offering = await setupUsageBasedFreeTrial({
                dimensionIds,
                freeTrialLength: argumentOffering.freeTrialLength,
            });
        } else {
            offering = await setupSubscriptionFreeTrial({
                dimensionIds,
                freeTrialLength: argumentOffering.freeTrialLength,
            });
        }
        const customer = await setupCustomerWallStrTrading({
            customerName: 'Free Trial Customer',
            offeringId: offering.offeringId,
        });
        // Create usage for the customer from the input, using input timestamps
        const usage = new Usage();

        for (const value of argumentUsage) {
            const { timeStamp, recordValue, dimensionName } = value;
            await usage.create({
                dimensionId: dimensionNameMap[dimensionName].dimensionId,
                recordValue,
                customerId: customer.customerId,
                timestamp: timeStamp.toISOString(),
            });
        }
        await sleep(2000);
        // Run the billing job using the date override supplied from the input
        if (invoiceIssued) {
            const res = await Scheduler.pushSingleJobToQueue(
                new Scheduler({
                    schedulerStatus: 'live',
                    schedulerType: 'billing',
                    scheduleParameters: {
                        customerId: customer.customerId,
                        freeTrialEnd,
                        startDateOverride: billingStartDate,
                        endDateOverride: billingEndDate,
                    },
                })
            );
            expect(res.message).toEqual('completed');
            await sleep(1000 * 10);
        }

        // Validate the outcome was expected by the control flow from the "expecataions" in the input In some cases invoices will not be created.
        const customerData = await customer.get();
        if (invoiceIssued) {
            expect(customerData.invoices.length).toBe(1);
            expect(customerData.invoices[0].totalAmountWithoutTax).toBeCloseTo(total as number, 2);
            lineItems?.forEach((lineItem) => {
                expect(customerData.invoices[0].lineItems).toContainEqual(lineItem);
            });
        } else {
            expect(customerData.invoices.length).toBe(0);
        }
        // Create a dimension, a offering, and a customer
    });
});

describe('Multiple Dimension Billing', () => {
    test.concurrent.each(BILLING_AGGREGATION_INPUT)(
        'Billing for various dimension combination',
        async (billingDimensionInformation) => {
            const offering = await setupSimpleUsageBasedOffering();
            const customer = await setupCustomerWallStrTrading({ offeringId: offering.offeringId });

            const dimensionResultMap = await Promise.all(
                billingDimensionInformation.map(
                    async ({ aggregationMethod, usageInput, aggregatedValue, unitName, usageIncrement }) => {
                        const dimensionName = (Math.random() + 1).toString(36).substring(7);
                        const dimension = await setupDimensionRequest(
                            null,
                            aggregationMethod,
                            dimensionName,
                            undefined,
                            usageIncrement
                        );

                        const usage = new Usage();
                        const date = new Date();
                        const firstDayOfLastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
                        // Create usage for the last month for the customer
                        // Increment the date by 1 minute for each usage record
                        let timestamp = firstDayOfLastMonth;

                        for (const value of usageInput) {
                            await usage.create({
                                dimensionId: dimension.dimensionId,
                                recordValue: value,
                                customerId: customer.customerId,
                                timestamp: timestamp.toISOString(),
                            });
                            timestamp = new Date(timestamp.getTime() + 1000 * 60);
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

            await sleep(1000 * 10);
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
            const customerData = await customer.get();
            expect(customerData.invoices.length).toBe(1);
            expect(customerData.invoices[0].totalAmountWithoutTax).toEqual(
                dimensionResultMap.reduce((acc, { aggregatedValue, consumptionPrice }) => {
                    acc += parseFloat(
                        (parseFloat(aggregatedValue ? aggregatedValue : '0') * parseFloat(consumptionPrice)).toFixed(5)
                    );
                    return parseFloat(acc.toFixed(5));
                }, 0)
            );
            expect(customerData.invoices[0].lineItems.length).toEqual(dimensionResultMap.length);
            customerData.invoices[0].lineItems.forEach((lineItem) => {
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
