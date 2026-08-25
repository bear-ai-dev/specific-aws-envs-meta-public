import { AggregationInterval } from '../client/publicClient/dimension.js';
import { OfferingType } from '../client/publicClient/offering.js';
import { DatetimeUtils } from '../utils/Datetime.js';
const calculateSubscriptionPriceRemaining = ({
    startDate,
    endDate,
    subscriptionPrice,
}: {
    startDate: Date;
    endDate: Date;
    subscriptionPrice: number;
}): number => {
    const billingDays: number = Math.round(Math.abs((endDate.getTime() - startDate.getTime()) / DatetimeUtils.oneDay));
    const amountDue: number =
        Math.round(100 * subscriptionPrice * (billingDays / DatetimeUtils.totalDaysInMonth())) / 100;

    return amountDue;
};

export const FREE_TRIAL_BILLING_INPUT = [
    [
        {
            testTitle: 'Free Trial with usage during free trial and some after',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: { offeringType: OfferingType.UsageBased, billingCycle: 'monthly', freeTrialLength: '3' },
            },
            usage: [
                {
                    // This should not appear in invoice
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 2000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 3000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 4000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 5000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            billingEndDate: DatetimeUtils.endOfDay(
                DatetimeUtils.lastDayOfMonthGivenDate(DatetimeUtils.daysAfterDate(new Date(), 9))
            ),
            billingStartDate: DatetimeUtils.beginningOfDay(DatetimeUtils.daysAfterDate(new Date(), 9)),
            freeTrialEnd: false,
            expectations: {
                invoiceIssued: true,
                total: 5,
            },
        },
    ],
    [
        {
            testTitle: 'Subscriptions should not issue an invoice when a free trial starts',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: {
                    offeringType: OfferingType.Subscription,
                    billingCycle: 'monthly',
                    freeTrialLength: '7',
                    subscriptionPrice: '10',
                },
            },
            usage: [
                {
                    // This should not appear in invoice
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            freeTrialEnd: false,
            expectations: {
                invoiceIssued: false,
            },
        },
    ],
    [
        {
            testTitle: 'Usage based offerings should not issue an invoice when a free trial starts',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: {
                    offeringType: OfferingType.UsageBased,
                    billingCycle: 'monthly',
                    freeTrialLength: '7',
                },
            },
            usage: [
                {
                    // This should not appear in invoice
                    timeStamp: new Date(),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            freeTrialEnd: false,
            expectations: {
                invoiceIssued: false,
            },
        },
    ],
    [
        {
            testTitle: 'Usage based offerings should issue a credit invoice at the end of the free trial',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: {
                    offeringType: OfferingType.UsageBased,
                    billingCycle: 'monthly',
                    freeTrialLength: '7',
                },
            },
            usage: [
                {
                    // This should appear in invoice as credit
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 2000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            freeTrialEnd: true,
            billingEndDate: DatetimeUtils.lastDayOfMonthGivenDate(DatetimeUtils.daysAfterDate(new Date(), 7)),
            billingStartDate: DatetimeUtils.firstDayOfMonthGivenDate(DatetimeUtils.daysAfterDate(new Date(), 7)),
            expectations: {
                invoiceIssued: true,
                total: 0,
                lineItems: [
                    { name: 'cpuHours - Free Trial Usage Offering - Free Trial Credit', quantity: -2, unitCost: 1 },
                ],
            },
        },
    ],
    [
        {
            testTitle:
                'If a billing schedule is fired while the customer is in a free trial the invoice total should be zero',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: { offeringType: OfferingType.UsageBased, billingCycle: 'monthly', freeTrialLength: '400' },
            },
            usage: [
                {
                    // This should not appear in invoice
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 2000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 3000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 4000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 5000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            billingEndDate: DatetimeUtils.endOfDay(
                DatetimeUtils.lastDayOfMonthGivenDate(DatetimeUtils.daysAfterDate(new Date(), 30))
            ),
            billingStartDate: DatetimeUtils.beginningOfDay(DatetimeUtils.daysAfterDate(new Date(), 1)),
            freeTrialEnd: false,
            expectations: {
                invoiceIssued: true,
                total: 0,
            },
        },
    ],
    [
        {
            testTitle:
                'If a billing schedule is fired while the customer is in a free trial the invoice total should be zero for subscription offerings',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: { offeringType: OfferingType.Subscription, billingCycle: 'monthly', freeTrialLength: '400' },
            },
            usage: [
                {
                    // This should not appear in invoice
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 2000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 3000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 4000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 5000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            billingEndDate: DatetimeUtils.endOfDay(
                DatetimeUtils.lastDayOfMonthGivenDate(DatetimeUtils.daysAfterDate(new Date(), 30))
            ),
            billingStartDate: DatetimeUtils.beginningOfDay(DatetimeUtils.daysAfterDate(new Date(), 1)),
            freeTrialEnd: false,
            expectations: {
                invoiceIssued: true,
                total: 0,
            },
        },
    ],
    [
        {
            testTitle: 'Subscription billing cycles should handle free trials which ends far in the future',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: { offeringType: OfferingType.Subscription, billingCycle: 'monthly', freeTrialLength: '400' },
            },
            usage: [
                {
                    // This should not appear in invoice
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 2000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 3000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 4000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 9).getTime() + 5000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            billingEndDate: DatetimeUtils.endOfDay(
                DatetimeUtils.lastDayOfMonthGivenDate(DatetimeUtils.daysAfterDate(new Date(), 30))
            ),
            billingStartDate: DatetimeUtils.beginningOfDay(DatetimeUtils.daysAfterDate(new Date(), 1)),
            freeTrialEnd: false,
            expectations: {
                invoiceIssued: true,
                total: 0,
            },
        },
    ],
    [
        {
            testTitle: 'Subscription billing cycles should handle free trials which end during the billing cycle',
            setup: {
                dimensions: [
                    {
                        dimensionName: 'cpuHours',
                        aggregationInterval: AggregationInterval.Hour,
                        consumptionPrice: '1',
                    },
                ],
                offering: { offeringType: OfferingType.Subscription, billingCycle: 'monthly', freeTrialLength: '3' },
            },
            usage: [
                {
                    // This should not appear in invoice
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 1).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 2).getTime() + 1000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 2).getTime() + 2000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 2).getTime() + 3000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 2).getTime() + 4000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
                {
                    timeStamp: new Date(DatetimeUtils.daysAfterDate(new Date(), 2).getTime() + 5000),
                    recordValue: '1',
                    dimensionName: 'cpuHours',
                },
            ],
            billingEndDate: DatetimeUtils.endOfDay(
                DatetimeUtils.lastDayOfMonthGivenDate(DatetimeUtils.daysAfterDate(new Date(), 30))
            ),
            billingStartDate: new Date(),
            freeTrialEnd: false,
            expectations: {
                invoiceIssued: true,
                total: 0,
            },
        },
    ],
];
