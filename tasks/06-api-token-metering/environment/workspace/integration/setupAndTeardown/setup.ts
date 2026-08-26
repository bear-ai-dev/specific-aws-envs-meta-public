import { Service } from '../client/publicClient/service.js';
import { SubscriptionOffering, UsageBasedOffering } from '../client/publicClient/offering.js';
import { UsageRecordInS3Measurement } from '../client/publicClient/measurement.js';
import { Customer, TaxExempt } from '../client/publicClient/customer.js';
import { Address } from '../client/publicClient/init.js';
import {
    AggregationInterval,
    AggregationMethod,
    Dimension,
    OverageAllowed,
    Rounding,
} from '../client/publicClient/dimension.js';
import {
    ArchiveCostSource,
    ComputeCostSource,
    StorageCostSource,
    TaxCalculationType,
} from '../client/privateClient/settings.js';

export const setupCustomerWallStrTrading = async ({
    customerName = 'Wall Street Trading',
    email = 'developer.two@meteringco.example',
    paymentChannel = 'manual',
    paymentChannelOptions,
    taxExempt = TaxExempt.None,
    customerVatId = 'VAT GB 1234567',
    address = new Address('us', 'W1J 8AJ', 'London', 'London', '1 Downing Street', ''),
    offeringId,
    currency,
    offeringEnrollmentDate,
}: {
    customerName?: string | null;
    email?: string | null;
    paymentChannel?: string | null;
    paymentChannelOptions?: { stripeCustomerId: string | null };
    taxExempt?: TaxExempt;
    customerVatId?: string | null;
    address?: Address;
    offeringId?: string | undefined | null;
    currency?: string;
    offeringEnrollmentDate?: string;
} = {}) => {
    const customer = new Customer();
    await customer.create({
        customerName,
        email,
        taxExempt,
        address,
        paymentChannel,
        paymentChannelOptions,
        customerVatId,
        offeringId,
        currency,
        offeringEnrollmentDate,
    });
    return customer;
};

export const setupDimensionRequest = async (
    measurementId: string | null = null,
    aggregationMethod: AggregationMethod = AggregationMethod.Sum,
    name: string = 'Request',
    rounding: Rounding = Rounding.Ceiling,
    usageIncrement: string = '1',
    consumptionUnit: string = 'count-based',
    consumptionType: string = 'count',
    usageEntitlement: number = 0,
    overageAllowed: OverageAllowed = OverageAllowed.True,
    consumptionPrice: string | undefined | null = '0.4'
) => {
    const dimension = new Dimension();
    await dimension.create({
        aggregationInterval: AggregationInterval.Hour,
        aggregationMethod,
        name,
        consumptionPrice,
        overageAllowed,
        usageEntitlement,
        rounding,
        usageIncrement,
        consumptionUnit: {
            unit: consumptionUnit,
            type: consumptionType,
        },
        measurementId,
    });
    return dimension;
};

export const setupSimpleUsageBasedOffering = async (dimensionIds?: string[], currency?: string) => {
    const offering = new UsageBasedOffering();
    await offering.create({
        offeringName: 'Simple Offering',
        dimensionIds,
        currency,
    });
    return offering;
};

export const setupUsageBasedFreeTrial = async ({
    freeTrialLength,
    dimensionIds,
    prepaidCredit,
}: {
    freeTrialLength: string;
    dimensionIds?: Array<string>;
    prepaidCredit?: string;
}): Promise<UsageBasedOffering> => {
    const offering = new UsageBasedOffering(null, null, dimensionIds, freeTrialLength);
    await offering.create({ dimensionIds, prepaidCredit, freeTrialLength, offeringName: 'Free Trial Usage Offering' });
    return offering;
};
export const setupSubscriptionFreeTrial = async ({
    dimensionIds,
    freeTrialLength,
    prepaidCredit,
}: {
    freeTrialLength: string;
    dimensionIds?: Array<string>;
    prepaidCredit?: string;
}) => {
    const offering = new SubscriptionOffering();
    await offering.create({
        offeringName: 'Free Trial Subscription Offering',
        subscriptionPrice: 10,
        freeTrialLength,
        dimensionIds,
        prepaidCredit,
    });
    return offering;
};

export const setupSimpleSubscriptionOffering = async (
    { subscriptionPrice, dimensionIds }: { subscriptionPrice: number | string; dimensionIds?: string[] } = {
        subscriptionPrice: 10,
        dimensionIds: [],
    }
) => {
    const offering = new SubscriptionOffering();
    await offering.create({
        offeringName: 'Simple Subscription Offering',
        dimensionIds,
        subscriptionPrice: subscriptionPrice.toString(),
    });
    return offering;
};

export const setupSimpleService = async (offeringId: string, customerId: string) => {
    const service = new Service();
    await service.create({
        offeringId,
        customerId,
        name: 'Simple Service',
    });
    return service;
};

export const setupS3Measurement = async (accountId: string = '123456789012') => {
    const measurement = new UsageRecordInS3Measurement();
    await measurement.create({
        name: 'Simple S3 Measurement',
        accountId,
    });
    return measurement;
};
export const resetSettingsInput = {
    accountState: 'production',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    country: '',
    postalCode: '',
    vatId: '',
    invoicePaymentTerm: '',
    stripeConnected: 'notConnected',
    customFields: '',
    logoUrl: '',
    taxCategory: '',
    taxCalculationType: TaxCalculationType.none,
    archiveCostSource: ArchiveCostSource.none,
    computeCostSource: ComputeCostSource.none,
    storageCostSource: StorageCostSource.none,
    stripeAccountId: '',
    businessName: '',
    taxRate: '0',
    taxJarApiKey: '',
    cloudIAM: {
        iamRoleArn: '',
        externalId: '',
    },
    freeDimensionOnInvoice: 'show',
    invoiceApproval: 'manual',
    pages: {
        invoice: {
            enabled: true,
            text: 'Invoice',
        },
        offering: {
            enabled: false,
            text: 'Plan',
        },
        payment: {
            enabled: false,
            text: 'Payment',
        },
    },
};
export const sampleBasicSettings = {
    businessName: 'Test Business',
    taxRate: '0',
    addressLine1: '123 Main St',
    addressLine2: 'Suite 1',
    city: 'San Francisco',
    state: 'CA',
    country: 'USA',
    postalCode: '94105',
    vatId: '123456789',
    invoicePaymentTerm: '30',
    customFields: '[]',
    logoUrl: 'https://www.google.com/images/branding/googlelogo/1x/googlelogo_color_272x92dp.png',
    taxCategory: 'Taxable',
    taxCalculationType: TaxCalculationType.none,
    stripeAccountId: 'acct_1MV2hfFMNNPXLiAl',
    archiveCostSource: ArchiveCostSource.ebs,
    computeCostSource: ComputeCostSource.eks,
    storageCostSource: StorageCostSource.ebs,
    cloudIAM: {
        iamRoleArn: 'arn:aws:iam::123456789012:role/meteringco-read-only',
        externalId: '',
    },
    invoiceApproval: 'manual',
};
