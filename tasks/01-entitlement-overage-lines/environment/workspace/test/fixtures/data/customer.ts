import { CustomerEntity, ReadCustomerResponseData } from '../../../src/customer/entities/customer.entity.js';
import { TaxExempt } from '../../../src/customer/dto/TaxExempt.js';
import { SupportedCurrencies } from '../../../src/offering/dto/SupportedCurrencies.js';
import { OfferingVisibility, ValidBillingCycles } from '../../../src/offering/dto/createOffering.dto.js';
import {
    PaymentSchedule,
    aggregationInterval,
    aggregationMethod,
    countBasedUnits,
    overageAllowedEnum,
    roundingEnum,
} from '../../../src/dimensions/dto/create-dimension.dto.js';
import { measurementMode } from '../../../src/measurement-config/dto/create-measurement-config.dto.js';
import {
    supportedCloudPlatforms,
    SupportedResources,
} from '../../../src/measurement-config/entities/measurement-config.entity.js';
import { Address, paymentChannel } from '../../../src/customer/dto/create-customer.dto.js';
import { draftInvoice, openedInvoice, paidInvoice, voidedInvoice } from './invoice.js';
import { CustomerInfluxRow } from '../../../src/influx/entities/customerInfluxRow.js';
import { productionBusinessID } from './user.js';

export const fullCustomerData: ReadCustomerResponseData = {
    taxExempt: TaxExempt.exempt,
    invoices: [openedInvoice, draftInvoice, voidedInvoice, paidInvoice],
    offering: {
        offeringVisibility: OfferingVisibility.private,
        offeringType: 'subscription',
        billingCycle: ValidBillingCycles.monthly,
        currency: SupportedCurrencies.USD,
        offeringId: '539b7f74-3832-474e-a955-6d69c5df12d0',
        dimensions: [
            {
                dimensionName: 'API Call',
                consumptionUnit: {
                    unit: countBasedUnits['count-based'],
                    type: 'count',
                },
                usageIncrement: '24',
                usageEntitlement: 'inf',
                aggregationInterval: aggregationInterval.hour,
                aggregationMethod: aggregationMethod.sum,
                dimensionId: '8a7b5f91-3b85-4cf4-8585-dcdf17f49004',
                measurement: {
                    measurementMode: measurementMode.infrastructureBased,
                    measurementConfiguration: {
                        iamRoleArn: 'arn:aws:iam::123456789012:role/meteringco-scraper',
                        externalId: '123456789',
                        cloudPlatform: supportedCloudPlatforms.aws,
                        region: 'us-east-1',
                        resourceType: SupportedResources.ebs,
                    },
                    measurementName: 'EBS Usage',
                    measurementId: 'de388932-a7e1-11ed-afa1-0242ac120002',
                },
                rounding: roundingEnum.round,
                overageAllowed: overageAllowedEnum.true,
                consumptionPrice: '20.00',
                paymentSchedule: PaymentSchedule.upfront,
            },
        ],
        discount: '0.2',
        prepaidCredit: '20.00',
        subscriptionPrice: 20,
        freeTrialLength: '1',
        offeringName: 'Entperise Plan',
    },
    stripeAccountReady: true,
    customerId: 'some-customer-id',
    customerName: 'someone',
    paymentChannel: paymentChannel.Stripe,
    email: 'noreply@meteringco.example',
    paymentChannelOptions: {
        stripeCustomerId: 'string',
    },
    address: {
        countryCode: 'US',
        postalCode: '90210',
        city: 'Beverly Hills',
        streetLineOne: '1234 Main St',
        streetLineTwo: 'Apt 1',
        state: 'NY',
    },
    customerVatId: 'GB VAT 123456789',
    offeringId: 'e345f409-daca-4144-91d2-0a0f87c96581',
    creditBalance: '100',
    freeTrialEndDate: '2020-12-31T23:59:59.999Z',
    offeringEnrollmentDate: '2020-12-31T23:59:59.999Z',
    freeTrialStartDate: '2020-12-31T23:59:59.999Z',
    currency: SupportedCurrencies.USD,
};

const customerDBModel: CustomerInfluxRow = {
    _measurement: CustomerEntity._measurement,
    _time: '2020-12-31T23:59:59.999Z',
    _value: 'Cool Customer',
    _field: 'customerName',
    customerId: fullCustomerData.customerId,
    paymentChannel: fullCustomerData.paymentChannel,
    email: 'test@meteringco.example',
    address: JSON.stringify({
        ...fullCustomerData.address,
    }),
    customerVatId: 'GB VAT 123456789',
    taxExempt: TaxExempt.none,
    freeTrialEndDate: fullCustomerData.freeTrialEndDate,
    currency: SupportedCurrencies.USD,
    creditBalance: '100',
    businessID: productionBusinessID,
    metadata: JSON.stringify({
        foo: 'bar',
    }),
    paymentChannelOptions_stripeCustomerId: 'foobar',
    offeringEnrollmentDate: fullCustomerData.offeringEnrollmentDate,
};
export const customerDBModelGenerator = () => JSON.parse(JSON.stringify(customerDBModel));
