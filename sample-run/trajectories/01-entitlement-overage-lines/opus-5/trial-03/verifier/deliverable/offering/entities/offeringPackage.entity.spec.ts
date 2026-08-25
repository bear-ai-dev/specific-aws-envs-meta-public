import { CustomerService } from '../../customer/customer.service.js';
import { paymentChannel } from '../../customer/dto/create-customer.dto.js';
import { ReadCustomerUsageData } from '../../customer/dto/read-customer.dto.js';
import { ReadCustomerResponseData } from '../../customer/entities/customer.entity.js';
import {
    PaymentSchedule,
    aggregationInterval,
    aggregationMethod,
    countBasedUnits,
    overageAllowedEnum,
    roundingEnum,
} from '../../dimensions/dto/create-dimension.dto.js';
import { InvoiceLineItem, InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { InvoicesService } from '../../invoice/invoices.service.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { DatetimeUtils } from '../../utils/datetime.js';
import { ValidBillingCycles } from '../dto/createOffering.dto.js';
import { ReadOfferingResponseData } from '../dto/readOffering.dto.js';
import { SupportedCurrencies } from '../dto/SupportedCurrencies.js';
import { Offering, Subscription } from '../entities/offeringPackage.entity.js';
import { AnalyticsService } from '../../analytics/analytics.service.js';
import { OfferingType } from './OfferingType.js';
import { CreditService } from '../../credit/credit.service.js';
import { Billing } from '../../billing/entities/billing.entity.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';
import { ReadDimensionResponseData } from '../dimensions/dto/ReadDimensionResponseData.js';
import { InvoiceGeneration } from '../../setting/dto/update-settings.dto.js';
import exp from 'constants';
jest.mock('../../analytics/analytics.service', () => ({
    AnalyticsService: {
        getExchangeRate: jest.fn(() => 0.91),
    },
}));

describe('OfferingPackageEntity', () => {
    let invoicesService: InvoicesService;
    let customerService: CustomerService;
    let schedulerService: SchedulerService;
    let basicSubscriptionOffering: ReadOfferingResponseData;
    let basicUsageOffering: ReadOfferingResponseData;
    let basicReadCustomerResponseData: ReadCustomerResponseData;
    let zeroConsumptionPriceDimension: ReadDimensionResponseData;
    let creditService: CreditService;
    let AnalyticsService: AnalyticsService;
    let fakeBusinessID = 'fakeBusinessID';
    let fakeCustomerID = 'fakeCustomerID';
    let freeTrialLength = '30';
    let fakeSettings = { freeDimensionOnInvoice: FreeDimensionOnInvoice.show } as ReadSettingsResponseData;

    beforeAll(async () => {
        //eslint-disable-next-line
        //@ts-ignore
        invoicesService = new InvoicesService();
        //eslint-disable-next-line
        //@ts-ignore
        customerService = new CustomerService();
        //eslint-disable-next-line
        //@ts-ignore
        schedulerService = new SchedulerService();
        //eslint-disable-next-line
        //@ts-ignore
        creditService = new CreditService();
        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(invoicesService, 'create').mockImplementation(async () => ({ invoiceId: '123', message: 'foobar' }));
        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(invoicesService, 'findOne').mockImplementation(async () => ({
            invoiceId: '123',
            message: 'foobar',
        }));

        jest.spyOn(invoicesService, 'queueInvoice').mockImplementation(async () => ({ message: 'foobar' }));
        jest.spyOn(invoicesService, 'consolidateInvoice').mockImplementation(async () => ({
            message: 'foobar',
            invoiceId: '123',
        }));
        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({}));
        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(customerService, 'create').mockImplementation(async () => ({}));

        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(async () => ({}));

        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(creditService, 'create').mockImplementation(async () => ({}));

        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(schedulerService, 'create').mockImplementation(async () => ({}));
        //eslint-disable-next-line
        //@ts-ignore
        jest.spyOn(schedulerService, 'emitOne').mockImplementation(async () => ({}));
    });
    beforeEach(async () => {
        jest.useFakeTimers('modern').setSystemTime(new Date('2023-08-16'));
        fakeBusinessID = 'fakeBusinessID';
        fakeCustomerID = 'fakeCustomerID';
        freeTrialLength = '30';
        basicSubscriptionOffering = {
            offeringId: '123',
            offeringName: 'foobar',
            offeringType: OfferingType.subscription,
            currency: SupportedCurrencies.USD,
            dimensions: [],
            subscriptionPrice: 100,
            billingCycle: ValidBillingCycles.monthly,
        };
        zeroConsumptionPriceDimension = {
            dimensionId: '123',
            dimensionName: 'foobar',
            aggregationInterval: aggregationInterval.day,
            aggregationMethod: aggregationMethod.sum,
            usageIncrement: '1',
            consumptionUnit: {
                unit: countBasedUnits['count-based'],
                type: 'count',
            },
            rounding: roundingEnum.ceiling,
            consumptionPrice: '0',
        };
        basicUsageOffering = {
            offeringId: '123',
            offeringName: 'foobar',
            offeringType: OfferingType.usageBased,
            currency: SupportedCurrencies.USD,
            dimensions: [],
            billingCycle: ValidBillingCycles.monthly,
        };

        basicReadCustomerResponseData = {
            customerId: fakeCustomerID,
            customerName: 'fakeCustomerName',
            paymentChannel: paymentChannel.manual,
            offering: basicSubscriptionOffering,
            businessID: fakeBusinessID,
            currency: SupportedCurrencies.USD,
            email: 'fakeEmail',
        };
    });
    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
    });

    afterAll(() => {
        jest.resetAllMocks();
    });

    describe('Offering', () => {
        test('Line Items should respect the precision of the rate passed into it when converting to EUR', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.EUR };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        consumptionPrice: '1.23456789',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                consumptionPrice: '1.23456789',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });
            expect(lineItems.getLineItems()).toEqual([
                // 1.12345678  = 0.91 * 1.23456789 (exchange rate math, 0.91 is the set exchange rate by the mocl)
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 2000, 1.12345678)),
            ]);
        });
        test('Line Items should respect the precision when using USD', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        consumptionPrice: '1.23456789',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                consumptionPrice: '1.23456789',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });
            expect(lineItems.getLineItems()).toEqual([
                // 1.12345678  = 0.91 * 1.23456789 (exchange rate math, 0.91 is the set exchange rate by the mocl)
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 2000, 1.23456789)),
            ]);
        });
        test('Line items should be generated correctly for dimension tiers', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiers: [
                            {
                                tierPosition: '1',
                                tierName: 'tier1',
                                upperBound: '100',
                                unitPrice: '0.01',
                            },
                            {
                                tierPosition: '2',
                                tierName: 'tier2',
                                upperBound: '100000',
                                unitPrice: '0.02',
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'tier1',
                                        upperBound: '100',
                                        unitPrice: '0.01',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'tier2',
                                        upperBound: '100000',
                                        unitPrice: '0.02',
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });
            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 100, 0.01)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier2', 1900, 0.02)),
            ]);
        });
        test('Line items should be generated correctly for dimension with grouped by metadata tiers', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                metadataGroup: { foo: 'bar' },
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                        metadataGroup: { foo: 'bar' },
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1000',
                                        metadataGroup: { foo: 'bar' },
                                    },
                                ],
                            },
                            {
                                dimensionId: '123',
                                metadataGroup: { baz: 'boo' },
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '500',
                                        metadataGroup: { baz: 'boo' },
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '500',
                                        metadataGroup: { baz: 'boo' },
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiersGroupByMetadata: [
                            {
                                metadataGroups: {
                                    foo: 'bar',
                                },
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'foobar tier 1',
                                        upperBound: '100',
                                        unitPrice: '1',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'foobar tier 2',
                                        upperBound: '100000',
                                        unitPrice: '30',
                                    },
                                ],
                            },
                            {
                                metadataGroups: {
                                    baz: 'boo',
                                },
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'bazboo tier 1',
                                        upperBound: '100',
                                        unitPrice: '0.01',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'bazboo tier 2',
                                        upperBound: '100000',
                                        unitPrice: '0.02',
                                    },
                                ],
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                tiersGroupByMetadata: [
                                    {
                                        metadataGroups: {
                                            foo: 'bar',
                                        },
                                        tiers: [
                                            {
                                                tierPosition: '1',
                                                tierName: 'foobar tier 1',
                                                upperBound: '100',
                                                unitPrice: '1',
                                            },
                                            {
                                                tierPosition: '2',
                                                tierName: 'foobar tier 2',
                                                upperBound: '100000',
                                                unitPrice: '30',
                                            },
                                        ],
                                    },
                                    {
                                        metadataGroups: {
                                            baz: 'boo',
                                        },
                                        tiers: [
                                            {
                                                tierPosition: '1',
                                                tierName: 'bazboo tier 1',
                                                upperBound: '100',
                                                unitPrice: '0.01',
                                            },
                                            {
                                                tierPosition: '2',
                                                tierName: 'bazboo tier 2',
                                                upperBound: '100000',
                                                unitPrice: '0.02',
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });
            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - foobar tier 1', 100, 1)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - foobar tier 2', 1900, 30)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - bazboo tier 1', 100, 0.01)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - bazboo tier 2', 900, 0.02)),
            ]);
        });
        test('Line items should be generated correctly for dimension tiers with no upperBound', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiers: [
                            {
                                tierPosition: '1',
                                tierName: 'tier1',
                                upperBound: '100',
                                unitPrice: '0.01',
                            },
                            {
                                tierPosition: '2',
                                tierName: 'infinte tier',
                                upperBound: 'inf',
                                unitPrice: '0.02',
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'tier1',
                                        upperBound: '100',
                                        unitPrice: '0.01',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'infinte tier',
                                        upperBound: 'inf',
                                        unitPrice: '0.02',
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });

            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 100, 0.01)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - infinte tier', 10900, 0.02)),
            ]);
        });
        test('Line items should be generated correctly for a dimension with only one tier', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiers: [
                            {
                                tierPosition: '1',
                                tierName: 'tier1',
                                upperBound: 'inf',
                                unitPrice: '0.02',
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'tier1',
                                        upperBound: 'inf',
                                        unitPrice: '0.02',
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });
            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 11000, 0.02)),
            ]);
        });
        test('Line items should be generated correctly for a dimension where the first tier doesnt have a unit price', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiers: [
                            {
                                tierPosition: '1',
                                tierName: 'tier1',
                                upperBound: '100',
                            },
                            {
                                tierPosition: '2',
                                tierName: 'infinte tier',
                                upperBound: 'inf',
                                unitPrice: '0.02',
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'tier1',
                                        upperBound: '100',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'infinte tier',
                                        upperBound: 'inf',
                                        unitPrice: '0.02',
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });

            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 100, 0.0)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - infinte tier', 10900, 0.02)),
            ]);
        });
        test('Line items should be generated correctly for a dimension where any tier doesnt have a unit price', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiers: [
                            {
                                tierPosition: '1',
                                tierName: 'tier1',
                                upperBound: '100',
                            },
                            {
                                tierPosition: '2',
                                tierName: 'infinte tier',
                                upperBound: 'inf',
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'tier1',
                                        upperBound: '100',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'infinte tier',
                                        upperBound: 'inf',
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });

            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 100, 0.0)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - infinte tier', 10900, 0.0)),
            ]);
        });
        test('Line items should be generated correctly for tiers where there is not overage', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiers: [
                            {
                                tierPosition: '1',
                                tierName: 'tier1',
                                upperBound: '100',
                                unitPrice: '0.01',
                            },
                            {
                                tierPosition: '2',
                                tierName: 'tier2',
                                upperBound: '200',
                                unitPrice: '0.02',
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'tier1',
                                        upperBound: '100',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'tier2',
                                        upperBound: '200',
                                        unitPrice: '0.02',
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });

            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 100, 0.01)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier2', 100, 0.02)),
            ]);
        });
        test('Line items should be genenerated correctly for a large number of tiers', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const tiers = [
                {
                    tierPosition: '1',
                    tierName: 'tier1',
                    upperBound: '100',
                    unitPrice: '0.01',
                },
                {
                    tierPosition: '2',
                    tierName: 'tier2',
                    upperBound: '200',
                    unitPrice: '0.02',
                },
                {
                    tierPosition: '3',
                    tierName: 'tier3',
                    upperBound: '300',
                    unitPrice: '0.03',
                },
                {
                    tierPosition: '4',
                    tierName: 'tier4',
                    upperBound: '400',
                    unitPrice: '0.04',
                },
                {
                    tierPosition: '5',
                    tierName: 'tier5',
                    upperBound: '500',
                    unitPrice: '0.05',
                },
                {
                    tierPosition: '6',
                    tierName: 'tier6',
                    upperBound: '600',
                    unitPrice: '0.06',
                },
                {
                    tierPosition: '7',
                    tierName: 'tier7',
                    upperBound: '700',
                    unitPrice: '0.07',
                },
                {
                    tierPosition: '8',
                    tierName: 'tier8',
                    upperBound: '800',
                    unitPrice: '0.08',
                },
                {
                    tierPosition: '9',
                    tierName: 'tier9',
                    upperBound: '900',
                    unitPrice: '0.09',
                },
                {
                    tierPosition: '10',
                    tierName: 'tier10',
                    upperBound: '1000',
                    unitPrice: '0.10',
                },
            ];
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '1',
                        tiers,
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '1',
                                usageEntitlement: 100,
                                tiers,
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });

            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 100, 0.01)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier2', 100, 0.02)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier3', 100, 0.03)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier4', 100, 0.04)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier5', 100, 0.05)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier6', 100, 0.06)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier7', 100, 0.07)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier8', 100, 0.08)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier9', 100, 0.09)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier10', 100, 0.1)),
            ]);
        });
        test('Line items should take into account usage increment with tiers', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '10',
                        tiers: [
                            {
                                tierPosition: '1',
                                tierName: 'tier1',
                                upperBound: '100',
                                unitPrice: '0.01',
                            },
                            {
                                tierPosition: '2',
                                tierName: 'tier2',
                                upperBound: '200',
                                unitPrice: '0.02',
                            },
                        ],
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '10',
                                tiers: [
                                    {
                                        tierPosition: '1',
                                        tierName: 'tier1',
                                        upperBound: '100',
                                    },
                                    {
                                        tierPosition: '2',
                                        tierName: 'tier2',
                                        upperBound: '200',
                                        unitPrice: '0.02',
                                    },
                                ],
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });

            expect(lineItems.getLineItems()).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier1', 10, 0.01)),
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar - tier2', 10, 0.02)),
            ]);
        });
        test('Line items without tiers, consumption price or entitlements should still work fine', async () => {
            basicReadCustomerResponseData = { ...basicReadCustomerResponseData, currency: SupportedCurrencies.USD };
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1000',
                                    },
                                    {
                                        startTime: new Date().toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '10000',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [
                    {
                        aggregationInterval: aggregationInterval.month,
                        aggregationMethod: aggregationMethod.sum,
                        dimensionName: 'fakeDimensionName',
                        rounding: roundingEnum.floor,
                        consumptionUnit: {
                            unit: countBasedUnits['count-based'],
                            type: 'count',
                        },
                        dimensionId: '123',
                        usageIncrement: '10',
                    },
                ],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    {
                        ...basicUsageOffering,
                        dimensions: [
                            {
                                aggregationInterval: aggregationInterval.month,
                                aggregationMethod: aggregationMethod.sum,
                                dimensionName: 'fakeDimensionName',
                                rounding: roundingEnum.floor,
                                consumptionUnit: {
                                    unit: countBasedUnits['count-based'],
                                    type: 'count',
                                },
                                dimensionId: '123',
                                usageIncrement: '10',
                            },
                        ],
                    },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });

            expect(lineItems.getLineItems()).toEqual([]);
        });
        test('Free trial scheduler must set parameters correctly', async () => {
            const offering = Offering.getInstance(
                {
                    ...basicSubscriptionOffering,
                    dimensions: [
                        {
                            aggregationInterval: aggregationInterval.month,
                            aggregationMethod: aggregationMethod.sum,
                            dimensionName: 'fakeDimensionName',
                            consumptionPrice: '1.23456789',
                            rounding: roundingEnum.floor,
                            consumptionUnit: {
                                unit: countBasedUnits['count-based'],
                                type: 'count',
                            },
                            dimensionId: '123',
                            usageIncrement: '1',
                        },
                    ],
                    freeTrialLength: freeTrialLength,
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
            );

            await offering.enroll('foobar', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledTimes(1);
            expect(schedulerService.emitOne).toBeCalledTimes(1);
            expect(schedulerService.emitOne).toBeCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({
                        businessID: fakeBusinessID,
                        scheduleParameters: expect.objectContaining({ businessID: fakeBusinessID }),
                    }),
                }),
            );
        });
    });
    describe('Allowances, overage and free dimensions', () => {
        const usageDimension = (overrides: Partial<ReadDimensionResponseData> = {}): ReadDimensionResponseData =>
            ({
                aggregationInterval: aggregationInterval.month,
                aggregationMethod: aggregationMethod.sum,
                dimensionName: 'fakeDimensionName',
                rounding: roundingEnum.floor,
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                dimensionId: '123',
                usageIncrement: '1',
                consumptionPrice: '2',
                ...overrides,
            }) as ReadDimensionResponseData;

        const lineItemsFor = async ({
            dimension,
            total,
            settings,
        }: {
            dimension: ReadDimensionResponseData;
            total: string;
            settings?: ReadSettingsResponseData;
        }) => {
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: dimension.dimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.fifthDayOfLastMonthAtMidnight(
                                            new Date(),
                                        ).toISOString(),
                                        endTime: new Date().toISOString(),
                                        value: total,
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const fakeCustomer = { ...basicReadCustomerResponseData, invoices: [], offering: basicUsageOffering };
            const lineItems = await Offering.getLineItemsForUsage({
                customerService: customerService,
                customer: fakeCustomer,
                startDate: DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                endDate: new Date(),
                customerId: fakeCustomerID,
                dimensions: [dimension],
                businessID: fakeBusinessID,
                lineItems: new InvoiceLineItems(),
                offeringInstance: Offering.getInstance(
                    { ...basicUsageOffering, dimensions: [dimension] },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    settings ? settings : fakeSettings,
                    schedulerService,
                    customerService,
                ),
            });
            return lineItems.getLineItems();
        };

        test('Dimensions without an allowance are charged for all of their usage', async () => {
            const lineItems = await lineItemsFor({ dimension: usageDimension(), total: '30' });
            expect(lineItems).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 30, 2)),
            ]);
        });

        test('An unlimited allowance charges nothing and earns no line', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({
                    usageEntitlement: 'inf',
                    overageAllowed: overageAllowedEnum.true,
                }),
                total: '30',
            });
            expect(lineItems).toEqual([]);
        });

        test('An allowance the usage has not exhausted charges nothing and earns no line', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({
                    usageEntitlement: 100,
                    overageAllowed: overageAllowedEnum.true,
                }),
                total: '30',
            });
            expect(lineItems).toEqual([]);
        });

        test('Only the usage past an exhausted allowance is charged for when overage is permitted', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({
                    usageEntitlement: 10,
                    overageAllowed: overageAllowedEnum.true,
                }),
                total: '30',
            });
            expect(lineItems).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 20, 2)),
            ]);
        });

        test('A plan which forbids overage charges nothing past the allowance', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({
                    usageEntitlement: 10,
                    overageAllowed: overageAllowedEnum.false,
                }),
                total: '30',
            });
            expect(lineItems).toEqual([]);
        });

        test('A plan which does not speak about overage charges nothing past the allowance', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({ usageEntitlement: 10 }),
                total: '30',
            });
            expect(lineItems).toEqual([]);
        });

        test('Chargeable usage respects the usage increment', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({
                    usageEntitlement: 100,
                    overageAllowed: overageAllowedEnum.true,
                    usageIncrement: '10',
                }),
                total: '300',
            });
            expect(lineItems).toEqual([
                expect.objectContaining(new InvoiceLineItem('fakeDimensionName - foobar', 20, 2)),
            ]);
        });

        test('Dimensions priced at zero earn a line reporting their usage when free dimensions are shown', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({ ...zeroConsumptionPriceDimension }),
                total: '30',
            });
            expect(lineItems).toEqual([expect.objectContaining(new InvoiceLineItem('foobar - foobar', 30, 0))]);
        });

        test('Dimensions priced at zero earn no line when the invoice settings hide free dimensions', async () => {
            const lineItems = await lineItemsFor({
                dimension: usageDimension({ ...zeroConsumptionPriceDimension }),
                total: '30',
                settings: { freeDimensionOnInvoice: FreeDimensionOnInvoice.hide } as ReadSettingsResponseData,
            });
            expect(lineItems).toEqual([]);
        });

        test('A priced dimension with no usage earns no line', async () => {
            const lineItems = await lineItemsFor({ dimension: usageDimension(), total: '0' });
            expect(lineItems).toEqual([]);
        });
    });
    describe('Subscription offerings', () => {
        beforeEach(() => {
            jest.useFakeTimers('modern').setSystemTime(new Date('2023-08-16'));
        });
        afterEach(() => {
            jest.clearAllMocks();
            jest.useRealTimers();
        });
        test('Subscription unenrollment should credit the remaining plan time if the boolean value is set on the unenrollment call', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const offeringInstance = Offering.getInstance(
                {
                    ...basicSubscriptionOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const fakeOfferingId = 'fake-offering-id';
            await offeringInstance.unenroll({
                customer: { ...basicReadCustomerResponseData, offeringId: fakeOfferingId },
                shouldCreditRemainingPlan: true,
                creditService: creditService,
            });
            expect(creditService.create).toBeCalledTimes(1);

            const { subscriptionEnd } = Billing.billingCycleToTimeRange(offeringInstance.billingCycle);
            expect(creditService.create).toHaveBeenCalledWith({
                businessID: fakeBusinessID,
                customerId: fakeCustomerID,
                timestamp: expect.anything(),
                transactionAmount: offeringInstance
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    .calculateRemainingAmountForSubscription({
                        startDate: DatetimeUtils.getCurrentUTCTime(),
                        endDate: new Date(subscriptionEnd),
                        exchangeRate: 0.91,
                        negative: false,
                        billingCycle: ValidBillingCycles.monthly,
                    })
                    .toFixed(2),
                metadata: expect.objectContaining({
                    reason: expect.anything(),
                    offeringId: fakeOfferingId,
                }),
            });
        });
        test('Subscription offering enrollment should call scheduler', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledTimes(1);
        });
        test('Subscriptions that end their free trial should bill for the rest of the subscription in the billing cycle', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const freeTrialEnd = DatetimeUtils.randomTimeYesterday(new Date());
            //eslint-disable-next-line
            //@ts-ignore
            offeringInstance.freeTrialEndDate = freeTrialEnd;
            const subscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');
            await offeringInstance.processFreeTrialEnd({
                customer: {
                    ...basicReadCustomerResponseData,
                    freeTrialEndDate: freeTrialEnd,
                },
            });
            expect(subscriptionLineItemSpy).toBeCalledTimes(1);
            expect(subscriptionLineItemSpy).toBeCalledWith(
                expect.objectContaining({ negative: false, startDate: freeTrialEnd, endDate: expect.anything() }),
            );
        });
        test('ISSUE-1008: Subscription offering enrollment should create an invoice if no free trial is specified', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const subscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(subscriptionLineItemSpy).toBeCalledTimes(1);
            expect(subscriptionLineItemSpy).toBeCalledWith(
                expect.objectContaining({
                    startDate: DatetimeUtils.beginningOfDay(new Date()),
                    endDate: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()),
                    exchangeRate: expect.anything(),
                    lineItems: expect.anything(),
                    negative: false,
                }),
            );
        });
        test('ISSUE-1008: Subscription offering process billing should create an invoice', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const subscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');
            await offeringInstance.processBilling();
            expect(schedulerService.create).toBeCalledTimes(0);
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(subscriptionLineItemSpy).toBeCalledTimes(1);
            expect(subscriptionLineItemSpy).toBeCalledWith(
                expect.objectContaining({
                    startDate: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfMonth()),
                    endDate: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()),
                    exchangeRate: expect.anything(),
                    lineItems: expect.anything(),
                    negative: false,
                }),
            );
        });
        test('Subscription offering enrollment should not create an invoice if a free trial is specified', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                Offering.calculateFreeTrialEndDate(freeTrialLength),
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(invoicesService.create).not.toBeCalled();
        });
        test('Subscription offering enrollment with upfront dimensions should prorate if billing cycle is monthly', async () => {
            const offeringInstance = Offering.getInstance(
                {
                    ...basicSubscriptionOffering,
                    billingCycle: ValidBillingCycles.monthly,
                    dimensions: [
                        {
                            dimensionId: '123',
                            dimensionName: 'fake',
                            consumptionUnit: {
                                type: 'count',
                                unit: countBasedUnits['count-based'],
                            },
                            usageIncrement: '1',
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '10',
                            paymentSchedule: PaymentSchedule.upfront,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                undefined,
                [
                    {
                        dimensionId: '123',
                        usage: [
                            {
                                value: '100',
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                            },
                        ],
                    },
                ],
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(invoicesService.create).toBeCalled();
            expect(invoicesService.create.mock.calls[0][0].items.lineItems[1].unitCost).toBe(5.16);
        });
        test('Subscription offering enrollment with upfront dimensions should not prorate if billing cycle is annualToDate', async () => {
            const offeringInstance = Offering.getInstance(
                {
                    ...basicSubscriptionOffering,
                    billingCycle: ValidBillingCycles.annualToDate,
                    dimensions: [
                        {
                            dimensionId: '123',
                            dimensionName: 'fake',
                            consumptionUnit: {
                                type: 'count',
                                unit: countBasedUnits['count-based'],
                            },
                            usageIncrement: '1',
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '10',
                            paymentSchedule: PaymentSchedule.upfront,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                undefined,
                [
                    {
                        dimensionId: '123',
                        usage: [
                            {
                                value: '100',
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                            },
                        ],
                    },
                ],
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(invoicesService.create).toBeCalled();
            expect(invoicesService.create.mock.calls[0][0].items.lineItems[1].unitCost).toBe(10);
        });
        test('Subscription offering enrollment with upfront dimensions should prorate tiers if billing cycle is monthly', async () => {
            const offeringInstance = Offering.getInstance(
                {
                    ...basicSubscriptionOffering,
                    billingCycle: ValidBillingCycles.monthly,
                    dimensions: [
                        {
                            dimensionId: '123',
                            dimensionName: 'fake',
                            consumptionUnit: {
                                type: 'count',
                                unit: countBasedUnits['count-based'],
                            },
                            usageIncrement: '1',
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '10',
                            paymentSchedule: PaymentSchedule.upfront,
                            tiers: [
                                {
                                    tierName: 'tier1',
                                    tierPosition: '1',
                                    upperBound: '100',
                                    unitPrice: '10',
                                },
                                {
                                    tierName: 'tier2',
                                    tierPosition: '2',
                                    upperBound: '200',
                                    unitPrice: '20',
                                },
                            ],
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                undefined,
                [
                    {
                        dimensionId: '123',
                        usage: [
                            {
                                value: '150',
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                            },
                        ],
                    },
                ],
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(invoicesService.create).toBeCalled();
            expect(invoicesService.create.mock.calls[0][0].items.lineItems[1].unitCost).toBe(5.16);
            expect(invoicesService.create.mock.calls[0][0].items.lineItems[2].unitCost).toBe(10.32);
        });
        test('Mixed upfront and arrear dimensions should only bill upfront on enrollment', async () => {
            const offeringInstance = Offering.getInstance(
                {
                    ...basicSubscriptionOffering,
                    dimensions: [
                        {
                            dimensionId: '123',
                            dimensionName: 'firstDimension',
                            consumptionUnit: {
                                type: 'count',
                                unit: countBasedUnits['count-based'],
                            },
                            usageIncrement: '1',
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '10',
                            paymentSchedule: PaymentSchedule.upfront,
                        },
                        {
                            dimensionId: '456',
                            dimensionName: 'secondDimension',
                            consumptionUnit: {
                                type: 'count',
                                unit: countBasedUnits['count-based'],
                            },
                            usageIncrement: '1',
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '10',
                            paymentSchedule: PaymentSchedule.arrear,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                undefined,
                [
                    {
                        dimensionId: '123',
                        usage: [
                            {
                                value: '100',
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                            },
                        ],
                    },
                    {
                        dimensionId: '456',
                        usage: [
                            {
                                value: '100',
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                            },
                        ],
                    },
                ],
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(invoicesService.create).toBeCalled();
            expect(invoicesService.create.mock.calls[0][0].items.lineItems.length).toBe(2);
            expect(invoicesService.create.mock.calls[0][0].items.lineItems[1].name).toBe(
                `firstDimension - ${basicSubscriptionOffering?.offeringName}`,
            );
        });
        test('Subscription offering enrollment calculate subscription line item correctly for Monthly', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(invoicesService.create).toBeCalled();
            expect(invoicesService.create).toBeCalledWith(
                expect.objectContaining({
                    items: expect.objectContaining({ lineItems: [expect.objectContaining({ unitCost: 51.61 })] }),
                }),
            );
        });
        test('Subscription offering enrollment calculate subscription line item correctly for annualToDate', async () => {
            const offeringInstance = Offering.getInstance(
                { ...basicSubscriptionOffering, billingCycle: ValidBillingCycles.annualToDate },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(invoicesService.create).toBeCalled();
            expect(invoicesService.create).toBeCalledWith(
                expect.objectContaining({
                    items: expect.objectContaining({ lineItems: [expect.objectContaining({ unitCost: 100 })] }),
                }),
            );
        });
        test('Subscription offering enrollment should call scheduler emit one and create on free trials', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                Offering.calculateFreeTrialEndDate(freeTrialLength),
            );
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(schedulerService.emitOne).toBeCalledTimes(1);
            expect(schedulerService.create).toBeCalledTimes(1);
        });
        test('Subscription process billing should create an invoice', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.processBilling();
            expect(invoicesService.create).toBeCalledTimes(1);
        });
        test('Subscription process billing should consider if a free trial is ending during the month', async () => {
            const freeTrialEndDate = DatetimeUtils.randomDateTimeForTheRestOftheMonth().toISOString();
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                freeTrialEndDate,
            );
            //eslint-disable-next-line
            //@ts-ignore
            const calculateSubscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');
            await offeringInstance.processBilling();
            expect(calculateSubscriptionLineItemSpy).toBeCalledTimes(2);
            expect(calculateSubscriptionLineItemSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    startDate: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfMonth()),
                    endDate: new Date(freeTrialEndDate),
                }),
            );
        });
        test('Subscription process billing should consider if a free trial is ending much later in the future', async () => {
            const freeTrialEndDate = Offering.calculateFreeTrialEndDate('100');
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                freeTrialEndDate,
            );
            //eslint-disable-next-line
            //@ts-ignore
            const calculateSubscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');
            await offeringInstance.processBilling();
            expect(calculateSubscriptionLineItemSpy).toBeCalledTimes(2);
            expect(calculateSubscriptionLineItemSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    startDate: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfMonth()),
                    endDate: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()),
                }),
            );
        });
        test('Subscription process billing should consider not look back at free trials which ended in the past', async () => {
            const freeTrialEndDate = DatetimeUtils.firstDayOfLastMonth();
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                freeTrialEndDate.toISOString(),
            );
            //eslint-disable-next-line
            //@ts-ignore
            const calculateSubscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');
            await offeringInstance.processBilling();
            expect(calculateSubscriptionLineItemSpy).toBeCalledTimes(1);
            expect(calculateSubscriptionLineItemSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    startDate: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfMonth()),
                    endDate: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()),
                }),
            );
        });
        test('Subscriptions with usage should consider free trials in the past', async () => {
            const updatedCustomerInstance = jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: '123',
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            basicSubscriptionOffering = {
                ...basicSubscriptionOffering,
                dimensions: [
                    {
                        dimensionId: '123',
                        consumptionPrice: '10',
                        dimensionName: 'fake',
                        rounding: roundingEnum.ceiling,
                        aggregationInterval: aggregationInterval.day,
                        aggregationMethod: aggregationMethod.sum,
                        consumptionUnit: {
                            type: 'count',
                            unit: countBasedUnits['count-based'],
                        },
                        usageIncrement: '1',
                    },
                ],
            };
            const freeTrialEndDate = DatetimeUtils.randomTimeAndDateLastMonth(new Date());
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                freeTrialEndDate.toISOString(),
            );
            //eslint-disable-next-line
            //@ts-ignore
            await offeringInstance.processBilling(undefined, undefined, undefined, true);
            // There is some async issue here that causes this test to fail occasionally
            // TODO: Fix this test
            expect(updatedCustomerInstance).toBeCalledTimes(2);
            expect(updatedCustomerInstance).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({}),
                expect.objectContaining({
                    startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfLastMonth()).toISOString(),
                    endTime: freeTrialEndDate.toISOString(),
                }),
            );
            expect(updatedCustomerInstance).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({}),
                expect.objectContaining({
                    startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfLastMonth()).toISOString(),
                    endTime: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfLastMonth()).toISOString(),
                }),
            );
        });
        test.each([
            ['2023-02-08T00:00:00Z', '2023-02-28T23:59:59.999Z', 75000],
            ['2023-02-01T00:00:00Z', '2023-02-28T23:59:59.999Z', 100000],
            ['2023-03-01T00:00:00.000Z', '2023-03-31T23:59:59.999Z', 100000],
            ['2023-05-15T12:01:59Z', '2023-05-31T23:59:59Z', 53221.33],
            ['2023-05-15T13:12:30Z', '2023-05-31T23:59:59Z', 53063.36],
            ['2023-05-15T11:12:30Z', '2023-05-31T23:59:59Z', 53332.18],
            ['2023-05-02T12:12:30Z', '2023-05-31T23:59:59Z', 95133.25],
            ['2023-01-01T00:00:00Z', '2023-01-31T23:59:59.999Z', 100000],
            ['2023-02-01T00:00:00Z', '2023-02-28T23:59:59.999Z', 100000],
            ['2023-03-01T00:00:00Z', '2023-03-31T23:59:59.999Z', 100000],
            ['2023-04-01T00:00:00Z', '2023-04-30T23:59:59.999Z', 100000],
            ['2023-05-01T00:00:00Z', '2023-05-31T23:59:59.999Z', 100000],
            ['2023-06-01T00:00:00Z', '2023-06-30T23:59:59.999Z', 100000],
            ['2023-07-01T00:00:00Z', '2023-07-31T23:59:59.999Z', 100000],
            ['2023-08-01T00:00:00Z', '2023-08-31T23:59:59.999Z', 100000],
            ['2023-09-01T00:00:00Z', '2023-09-30T23:59:59.999Z', 100000],
            ['2023-10-01T00:00:00Z', '2023-10-31T23:59:59.999Z', 100000],
            ['2023-11-01T00:00:00Z', '2023-11-30T23:59:59.999Z', 100000],
            ['2023-12-01T00:00:00Z', '2023-12-31T23:59:59.999Z', 100000],
            ['2023-01-01T00:01:00Z', '2023-01-31T23:59:59.999Z', 99997.76],
            ['2023-02-01T00:01:00Z', '2023-02-28T23:59:59.999Z', 99997.52],
            ['2023-03-01T00:01:00Z', '2023-03-31T23:59:59.999Z', 99997.76],
            ['2023-04-01T00:01:00Z', '2023-04-30T23:59:59.999Z', 99997.69],
            ['2023-05-01T00:01:00Z', '2023-05-31T23:59:59.999Z', 99997.76],
            ['2023-06-01T00:01:00Z', '2023-06-30T23:59:59.999Z', 99997.69],
            ['2023-07-01T00:01:00Z', '2023-07-31T23:59:59.999Z', 99997.76],
            ['2023-08-01T00:01:00Z', '2023-08-31T23:59:59.999Z', 99997.76],
            ['2023-09-01T00:01:00Z', '2023-09-30T23:59:59.999Z', 99997.69],
            ['2023-10-01T00:01:00Z', '2023-10-31T23:59:59.999Z', 99997.76],
            ['2023-11-01T00:01:00Z', '2023-11-30T23:59:59.999Z', 99997.69],
            ['2023-12-01T00:01:00Z', '2023-12-31T23:59:59.999Z', 99997.76],
        ])(
            'calculate expected total for remaining subscription, start: %i end: %i expected total: %i',
            async (start, end, expected) => {
                const offeringInstance = Offering.getInstance(
                    { ...basicSubscriptionOffering, subscriptionPrice: 100000 },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                ) as Subscription;

                const totalRemaining = await offeringInstance.calculateRemainingAmountForSubscription({
                    startDate: new Date(start),
                    endDate: new Date(end),
                    exchangeRate: 1,
                    negative: false,
                    billingCycle: ValidBillingCycles.monthly,
                });
                expect(totalRemaining).toBe(expected);
            },
        );
        test.each([['2023-08-15T00:00:00Z', '2023-08-31T23:59:59.999Z', 26.87]])(
            'calculate expected total for remaining subscription lower subscription price, start: %i end: %i expected total: %i',
            async (start, end, expected) => {
                const offeringInstance = Offering.getInstance(
                    { ...basicSubscriptionOffering, subscriptionPrice: 49 },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                );
                //eslint-disable-next-line
                //@ts-ignore
                const totalRemaining = await offeringInstance.calculateRemainingAmountForSubscription({
                    startDate: new Date(start),
                    endDate: new Date(end),
                    exchangeRate: 1,
                    negative: false,
                    billingCycle: ValidBillingCycles.monthly,
                });
                expect(totalRemaining).toBe(expected);
            },
        );
        test.each([
            ['2023-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 49],
            ['2023-01-02T00:00:00Z', '2024-01-02T00:00:00Z', 49],
            ['2023-01-03T00:00:00Z', '2024-01-03T00:00:00Z', 49],
            ['2023-01-04T00:00:00Z', '2024-01-04T00:00:00Z', 49],
            ['2023-01-05T00:00:00Z', '2024-01-05T00:00:00Z', 49],
            ['2023-01-06T00:00:00Z', '2024-01-06T00:00:00Z', 49],
            ['2023-01-07T00:00:00Z', '2024-01-07T00:00:00Z', 49],
            ['2023-01-08T00:00:00Z', '2024-01-08T00:00:00Z', 49],
            ['2023-01-09T00:00:00Z', '2024-01-09T00:00:00Z', 49],
            ['2023-01-10T00:00:00Z', '2024-01-10T00:00:00Z', 49],
            ['2023-01-11T00:00:00Z', '2024-01-11T00:00:00Z', 49],
            ['2023-01-12T00:00:00Z', '2024-01-12T00:00:00Z', 49],
            ['2023-01-13T00:00:00Z', '2024-01-13T00:00:00Z', 49],
            ['2023-01-14T00:00:00Z', '2024-01-14T00:00:00Z', 49],
            ['2023-01-15T00:00:00Z', '2024-01-15T00:00:00Z', 49],
            ['2023-01-16T00:00:00Z', '2024-01-16T00:00:00Z', 49],
            ['2023-02-01T00:00:00Z', '2024-02-01T00:00:00Z', 49],
            ['2023-03-01T00:00:00Z', '2024-03-01T00:00:00Z', 49],
            ['2023-04-01T00:00:00Z', '2024-04-01T00:00:00Z', 49],
            ['2023-05-01T00:00:00Z', '2024-05-01T00:00:00Z', 49],
            ['2023-06-01T00:00:00Z', '2024-06-01T00:00:00Z', 49],
            ['2023-07-01T00:00:00Z', '2024-07-01T00:00:00Z', 49],
            ['2023-08-01T00:00:00Z', '2024-08-01T00:00:00Z', 49],
            ['2023-09-01T00:00:00Z', '2024-09-01T00:00:00Z', 49],
            ['2023-10-01T00:00:00Z', '2024-10-01T00:00:00Z', 49],
            ['2023-11-01T00:00:00Z', '2024-11-01T00:00:00Z', 49],
            ['2023-12-01T00:00:00Z', '2024-12-01T00:00:00Z', 49],
            ['2024-02-29T00:00:00Z', '2025-02-29T00:00:00Z', 49],
        ])(
            'calculate expected total for annual to date subscriptions, start: %i end: %i expected total: %i',
            async (start, end, expected) => {
                const offeringInstance = Offering.getInstance(
                    { ...basicSubscriptionOffering, subscriptionPrice: 49 },
                    fakeCustomerID,
                    fakeBusinessID,
                    invoicesService,
                    fakeSettings,
                    schedulerService,
                    customerService,
                );
                //eslint-disable-next-line
                //@ts-ignore
                const totalRemaining = await offeringInstance.calculateRemainingAmountForSubscription({
                    startDate: new Date(start),
                    endDate: new Date(end),
                    exchangeRate: 1,
                    negative: false,
                    billingCycle: ValidBillingCycles.annualToDate,
                });
                expect(totalRemaining).toBe(expected);
            },
        );
        test('Subscription offerings which upgrade should calculate the start time of the subscription to be right now, not the start of the day', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            ) as Subscription;
            //eslint-disable-next-line
            //@ts-ignore
            const calculateSubscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');

            await offeringInstance.processBilling(
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                true,
            );
            expect(calculateSubscriptionLineItemSpy).toBeCalledTimes(1);
            expect(calculateSubscriptionLineItemSpy).toBeCalledWith(
                expect.objectContaining({
                    startDate: expect.any(Date),
                    endDate: expect.any(Date),
                }),
            );
            expect(calculateSubscriptionLineItemSpy.mock.calls[0][0].startDate.getTime()).toBeCloseTo(
                new Date().getTime(),
                -3,
            );
        });
        test('Subscription Enrollment should understand upgrades when prior offering enrollment date is set', async () => {
            const offeringInstance = Offering.getInstance(
                basicSubscriptionOffering,
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            ) as Subscription;
            //eslint-disable-next-line
            //@ts-ignore
            const calculateSubscriptionLineItemSpy = jest.spyOn(offeringInstance, 'calculateSubscriptionLineItem');
            offeringInstance.priorOfferingEnrollmentDate = new Date().toISOString();
            await offeringInstance.enroll('fakeSubject', basicReadCustomerResponseData);
            expect(calculateSubscriptionLineItemSpy).toBeCalledTimes(1);
            expect(calculateSubscriptionLineItemSpy).toBeCalledWith(
                expect.objectContaining({
                    startDate: expect.any(Date),
                    endDate: expect.any(Date),
                }),
            );
            expect(calculateSubscriptionLineItemSpy.mock.calls[0][0].startDate.getTime()).toBeCloseTo(
                new Date().getTime(),
                -3,
            );
        });
    });

    describe('Usage based offering', () => {
        beforeEach(() => {
            jest.useFakeTimers('modern').setSystemTime(new Date('2023-08-16'));
            jest.clearAllMocks();
        });
        afterEach(() => {
            jest.useRealTimers();
        });
        test('ISSUE-1007: Should Create an invoice for process billing when called', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.processBilling();
            expect(customerService.findUsageForCustomer).toBeCalledTimes(1);
            expect(customerService.findUsageForCustomer).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfLastMonth()).toISOString(),
                    endTime: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfLastMonth()).toISOString(),
                }),
            );
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    invoiceDate: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfLastMonth()).toISOString(),
                }),
            );
        });
        test('Usage based offerings with a minimum charge should use the minimum charge value if the current usage is below the minimum charge dollar amount', async () => {
            const sharedDimensionId = '123';
            basicUsageOffering = {
                ...basicUsageOffering,
                minimumCharge: '10000',
            };
            customerService.findUsageForCustomer = jest.fn().mockResolvedValue({
                data: [
                    {
                        dimensionId: sharedDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '1000',
                            },
                        ],
                    },
                ],
                message: 'foobar',
            } as ReadCustomerUsageData);
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '2',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.processBilling();
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([expect.objectContaining({ unitCost: 10000, quantity: 1 })]),
                    },
                }),
            );
        });
        test('Usage based offerings with a minimum charge should use the usage value if the current usage is above the minimum charge dollar amount', async () => {
            const sharedDimensionId = '123';
            basicUsageOffering = {
                ...basicUsageOffering,
                minimumCharge: '10000',
            };
            customerService.findUsageForCustomer = jest.fn().mockResolvedValue({
                data: [
                    {
                        dimensionId: sharedDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '10000',
                            },
                        ],
                    },
                ],
                message: 'foobar',
            } as ReadCustomerUsageData);
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '2',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.processBilling();
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([expect.objectContaining({ unitCost: 2, quantity: 10000 })]),
                    },
                }),
            );
        });
        test('Usage based offerings with a minimum charge should be offering enrollment date aware if its set', async () => {
            jest.useFakeTimers('modern').setSystemTime(new Date('2023-08-16'));
            const sharedDimensionId = '123';
            basicUsageOffering = {
                ...basicUsageOffering,
                minimumCharge: '49.99',
            };
            const offeringEnrollmentDate = DatetimeUtils.randomTimeYesterday(new Date()).toISOString();
            const fakeCustomer = {
                ...basicReadCustomerResponseData,
                invoices: [],
                offering: basicUsageOffering,
                offeringEnrollmentDate,
            };
            customerService.findUsageForCustomer = jest.fn().mockResolvedValue({
                data: [
                    {
                        dimensionId: sharedDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '1',
                            },
                        ],
                    },
                ],
                message: 'foobar',
            } as ReadCustomerUsageData);
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '2',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const { currentBillingCycleStartTime } = Billing.billingCycleToTimeRange(ValidBillingCycles.monthly);
            const endDate = DatetimeUtils.endOfDay(new Date());
            await offeringInstance.unenroll({ customer: fakeCustomer });
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([
                            expect.objectContaining({
                                unitCost: Offering.determineRemainingMinimumCharge({
                                    startDate: DatetimeUtils.beginningOfDay(new Date(offeringEnrollmentDate)),
                                    endDate,
                                    exchangeRate: 1,
                                    negative: false,
                                    price: 49.99,
                                    billingCycle: ValidBillingCycles.monthly,
                                }),
                                quantity: 1,
                            }),
                        ]),
                    },
                }),
            );
            jest.useRealTimers();
        });
        test('Usage based offerings with a minimum charge should be offering enrollment date aware on general process billing requests', async () => {
            const sharedDimensionId = '123';
            basicUsageOffering = {
                ...basicUsageOffering,
                minimumCharge: '10000',
            };
            let offeringEnrollmentDate = DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString();

            if (DatetimeUtils.beginningOfDay(new Date(offeringEnrollmentDate)).getDate() < 3) {
                offeringEnrollmentDate = DatetimeUtils.beginningOfDay(
                    new Date(
                        new Date(offeringEnrollmentDate).setDate(
                            DatetimeUtils.beginningOfDay(new Date(offeringEnrollmentDate)).getDate() + 2,
                        ),
                    ),
                ).toISOString();
            }

            const fakeCustomer = {
                ...basicReadCustomerResponseData,
                invoices: [],
                offering: basicUsageOffering,
                offeringEnrollmentDate,
            };
            customerService.findUsageForCustomer = jest.fn().mockResolvedValue({
                data: [
                    {
                        dimensionId: sharedDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '1',
                            },
                        ],
                    },
                ],
                message: 'foobar',
            } as ReadCustomerUsageData);
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '2',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const { endTime } = Billing.billingCycleToTimeRange(ValidBillingCycles.monthly);
            const endDate = DatetimeUtils.endOfDay(new Date(endTime));
            await offeringInstance.processBilling(undefined, undefined, fakeCustomer);
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([
                            expect.objectContaining({
                                unitCost: Offering.determineRemainingMinimumCharge({
                                    startDate: DatetimeUtils.beginningOfDay(new Date(offeringEnrollmentDate)),
                                    endDate,
                                    exchangeRate: 1,
                                    negative: false,
                                    price: 10000,
                                    billingCycle: ValidBillingCycles.monthly,
                                }),
                                quantity: 1,
                            }),
                        ]),
                    },
                }),
            );
        });
        test('Usage based offerings with a minimum charge should have multiple line items if there are multiple dimensions', async () => {
            const sharedDimensionId = '123';
            const secondDimensionId = '456';
            basicUsageOffering = {
                ...basicUsageOffering,
                minimumCharge: '10000',
            };
            customerService.findUsageForCustomer = jest.fn().mockResolvedValue({
                data: [
                    {
                        dimensionId: sharedDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '10000',
                            },
                        ],
                    },
                    {
                        dimensionId: secondDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '2',
                            },
                        ],
                    },
                ],
                message: 'foobar',
            } as ReadCustomerUsageData);
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '2',
                        },
                        {
                            dimensionId: secondDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '1',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.processBilling();
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([
                            expect.objectContaining({ unitCost: 2, quantity: 10000 }),
                            expect.objectContaining({ unitCost: 1, quantity: 2 }),
                        ]),
                    },
                }),
            );
        });
        test('Usage based offerings with a minimum charge during a free trial should have negated the minimum charge', async () => {
            const sharedDimensionId = '123';
            basicUsageOffering = {
                ...basicUsageOffering,
                minimumCharge: '10000',
            };
            customerService.findUsageForCustomer = jest.fn().mockResolvedValue({
                data: [
                    {
                        dimensionId: sharedDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '10',
                            },
                        ],
                    },
                ],
                message: 'foobar',
            } as ReadCustomerUsageData);
            const freeTrialEndDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
            const fakeCustomer = {
                ...basicReadCustomerResponseData,
                invoices: [],
                offering: basicUsageOffering,
                freeTrialEndDate,
            };
            jest.spyOn(customerService, 'findOne').mockImplementation(async () => ({
                data: [{ ...fakeCustomer }],
                message: 'test',
            }));
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '2',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                freeTrialEndDate,
            );
            await offeringInstance.processBilling(undefined, undefined, fakeCustomer);
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([
                            expect.objectContaining({ unitCost: 10000, quantity: 1 }),
                            expect.objectContaining({ unitCost: -10000, quantity: 1 }),
                        ]),
                    },
                }),
            );
        });
        test('Unenrollments should be prorated by the number of days left in the current billing cycle', async () => {
            const sharedDimensionId = '123';
            basicUsageOffering = {
                ...basicUsageOffering,
                minimumCharge: '10000',
            };
            const fakeCustomer = {
                ...basicReadCustomerResponseData,
                invoices: [],
                offering: basicUsageOffering,
            };
            customerService.findUsageForCustomer = jest.fn().mockResolvedValue({
                data: [
                    {
                        dimensionId: sharedDimensionId,
                        usage: [
                            {
                                startTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                                endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                value: '1',
                            },
                        ],
                    },
                ],
                message: 'foobar',
            } as ReadCustomerUsageData);
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '2',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const { currentBillingCycleStartTime } = Billing.billingCycleToTimeRange(ValidBillingCycles.monthly);
            const startDate = DatetimeUtils.beginningOfDay(new Date(currentBillingCycleStartTime));
            const endDate = DatetimeUtils.endOfDay(new Date());
            await offeringInstance.unenroll({ customer: fakeCustomer });
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([
                            expect.objectContaining({
                                unitCost: Offering.determineRemainingMinimumCharge({
                                    startDate,
                                    endDate,
                                    exchangeRate: 1,
                                    negative: false,
                                    price: 10000,
                                    billingCycle: ValidBillingCycles.monthly,
                                }),
                                quantity: 1,
                            }),
                        ]),
                    },
                }),
            );
        });
        test('ISSUE-1007: Should not create an invoice immedaitely when enrolled is called', async () => {
            const offeringInstance = Offering.getInstance(
                basicUsageOffering,
                fakeCustomerID,
                fakeBusinessID,
                fakeSettings,
                invoicesService,
                schedulerService,
                customerService,
            );
            await offeringInstance.enroll('fake');
            expect(invoicesService.create).toBeCalledTimes(0);
            expect(schedulerService.create).toBeCalledTimes(1);
        });
        test('ISSUE-1002: Should use free trial date exactly when calculating usage', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const freeTrialEndDate = DatetimeUtils.randomTimeAndDateLastMonth(new Date());
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                freeTrialEndDate.toISOString(),
            );
            await offeringInstance.processBilling();
            expect(customerService.findUsageForCustomer).toBeCalledTimes(2);
            expect(customerService.findUsageForCustomer).toHaveBeenNthCalledWith(
                1,
                expect.anything(),
                expect.objectContaining({
                    startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfLastMonth()).toISOString(),
                    endTime: freeTrialEndDate.toISOString(),
                }),
            );
            expect(customerService.findUsageForCustomer).toHaveBeenNthCalledWith(
                2,
                expect.anything(),
                expect.objectContaining({
                    startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfLastMonth()).toISOString(),
                    endTime: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfLastMonth()).toISOString(),
                }),
            );

            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    invoiceDate: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfLastMonth()).toISOString(),
                }),
            );
        });

        test('Usage based offerings for unenrollment should only bill for this month so far', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const offeringResponseData = {
                ...basicUsageOffering,
                dimensions: [
                    {
                        dimensionId: sharedDimensionId,
                        dimensionName: 'fake',
                        usageIncrement: '1',
                        consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                        rounding: roundingEnum.ceiling,
                    },
                ],
            };
            const offeringInstance = Offering.getInstance(
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                { ...offeringResponseData },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            await offeringInstance.unenroll({
                customer: { ...basicReadCustomerResponseData },
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                offering: { ...offeringResponseData },
            });
            expect(customerService.findUsageForCustomer).toBeCalledTimes(1);
            expect(customerService.findUsageForCustomer).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfMonth()).toISOString(),
                    endTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                }),
            );
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    invoiceDate: DatetimeUtils.endOfDay(new Date()).toISOString(),
                }),
            );
        });
        test('Usage Based offerings should not call the credit creation service when unenrollment occurs', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const fakeOfferingId = 'fake-offering-id';
            await offeringInstance.unenroll({
                customer: { ...basicReadCustomerResponseData, offeringId: fakeOfferingId },
                shouldCreditRemainingPlan: true,
                creditService: creditService,
            });
            expect(creditService.create).toBeCalledTimes(0);
        });

        test('Usage Based offerings should not call invoice creation when changing plans and the invoice generation state is set to per billing cycle', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            fakeSettings = { ...fakeSettings, invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle };
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            const fakeOfferingId = 'fake-offering-id';
            await offeringInstance.unenroll({
                customer: { ...basicReadCustomerResponseData, offeringId: fakeOfferingId },
                isChangeOfPlan: true,
                creditService: creditService,
            });
            expect(invoicesService.create).toBeCalledTimes(0);
            expect(invoicesService.queueInvoice).toBeCalledTimes(1);
        });
        test('Usage Based offerings should consolidate invoices if the consolidate invoice flag is set on the offering and process billing is called', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            fakeSettings = { ...fakeSettings, invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle };
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            offeringInstance.consolidatedInvoice = true;
            await offeringInstance.processBilling();
            expect(invoicesService.create).toBeCalledTimes(0);
            expect(invoicesService.consolidateInvoice).toBeCalledTimes(1);
        });
        it('should apply the correct discount to the invoice', async () => {
            const discountPercentage = '10'; // 10% discount
            const usageValue = 100;
            const invoiceTotal = 550; // The usage value
            const expectedDiscountAmount = invoiceTotal * (parseInt(discountPercentage) / 100) * -1;
            const sharedDimensionId = '123';

            // Mock the findUsageForCustomer method to return a usage value
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: usageValue.toString(),
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );

            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,

                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '5.5',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            offeringInstance.discount = { name: 'test', percentage: discountPercentage };

            await offeringInstance.processBilling();
            expect(invoicesService.create).toBeCalledTimes(1);
            expect(invoicesService.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    items: {
                        lineItems: expect.arrayContaining([
                            expect.objectContaining({ name: 'fake - foobar', quantity: 100, unitCost: 5.5 }),
                            expect.objectContaining({
                                unitCost: expectedDiscountAmount,
                                quantity: 1,
                            }),
                        ]),
                    },
                }),
            );
        });

        test('Usage based offerings should consolidate invoices and pass along the generated invoice as an argument to the consolidate invoice function', async () => {
            const sharedDimensionId = '123';
            jest.spyOn(customerService, 'findUsageForCustomer').mockImplementation(
                async () =>
                    ({
                        message: 'fake',
                        data: [
                            {
                                dimensionId: sharedDimensionId,
                                usage: [
                                    {
                                        startTime: DatetimeUtils.beginningOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        endTime: DatetimeUtils.endOfDay(
                                            DatetimeUtils.fifthDayOfLastMonthAtMidnight(new Date()),
                                        ).toISOString(),
                                        value: '1',
                                    },
                                    {
                                        startTime: DatetimeUtils.endOfDay(new Date()).toISOString(),
                                        endTime: DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
                                        value: '1',
                                    },
                                ],
                            },
                        ],
                    }) as ReadCustomerUsageData,
            );
            fakeSettings = { ...fakeSettings, invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle };
            const offeringInstance = Offering.getInstance(
                {
                    ...basicUsageOffering,
                    dimensions: [
                        {
                            dimensionId: sharedDimensionId,
                            dimensionName: 'fake',
                            usageIncrement: '1',
                            consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                            rounding: roundingEnum.ceiling,
                            consumptionPrice: '1',
                        },
                    ],
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
            );
            offeringInstance.consolidatedInvoice = true;
            await offeringInstance.processBilling();
            expect(invoicesService.create).toBeCalledTimes(0);
            expect(invoicesService.consolidateInvoice).toBeCalledTimes(1);
            expect(invoicesService.consolidateInvoice).toBeCalledWith(
                expect.objectContaining({
                    initalLineItems: expect.objectContaining({
                        lineItems: expect.arrayContaining([{ name: expect.anything(), quantity: 2, unitCost: 1 }]),
                    }),
                    startTime: DatetimeUtils.firstDayOfLastMonth().toISOString(),
                    endTime: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfLastMonth()).toISOString(),
                }),
            );
        });
    });
    describe('Billing Cycle Testing', () => {
        test('annualToDate Billing cycle must be set correctly', async () => {
            const offering = Offering.getInstance(
                {
                    ...basicSubscriptionOffering,
                    billingCycle: ValidBillingCycles.annualToDate,
                    dimensions: [
                        {
                            aggregationInterval: aggregationInterval.month,
                            aggregationMethod: aggregationMethod.sum,
                            dimensionName: 'fakeDimensionName',
                            consumptionPrice: '1.23456789',
                            rounding: roundingEnum.floor,
                            consumptionUnit: {
                                unit: countBasedUnits['count-based'],
                                type: 'count',
                            },
                            dimensionId: '123',
                            usageIncrement: '1',
                        },
                    ],
                    freeTrialLength: freeTrialLength,
                },
                fakeCustomerID,
                fakeBusinessID,
                invoicesService,
                fakeSettings,
                schedulerService,
                customerService,
                DatetimeUtils.endOfTomorrow(new Date()).toISOString(),
            );

            await offering.enroll('foobar', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledTimes(1);
            expect(schedulerService.create).toBeCalledWith(expect.objectContaining({ rate: '0 0 16 8 *' }));
            expect(schedulerService.emitOne).toBeCalledTimes(1);
            expect(schedulerService.emitOne).toBeCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({
                        businessID: fakeBusinessID,
                        scheduleParameters: expect.objectContaining({ businessID: fakeBusinessID }),
                    }),
                }),
            );
            jest.useFakeTimers('modern').setSystemTime(new Date('2023-09-01'));
            await offering.enroll('foobar', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledWith(expect.objectContaining({ rate: '0 0 1 9 *' }));
            jest.useFakeTimers('modern').setSystemTime(new Date('2025-10-11'));
            await offering.enroll('foobar', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledWith(expect.objectContaining({ rate: '0 0 11 10 *' }));

            jest.useFakeTimers('modern').setSystemTime(new Date('2025-12-31'));
            await offering.enroll('foobar', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledWith(expect.objectContaining({ rate: '0 0 31 12 *' }));
            jest.useFakeTimers('modern').setSystemTime(new Date('2025-01-01'));
            await offering.enroll('foobar', basicReadCustomerResponseData);
            expect(schedulerService.create).toBeCalledWith(expect.objectContaining({ rate: '0 0 1 1 *' }));
        });
    });
});
