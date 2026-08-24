import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InvoicesService } from '../invoice/invoices.service.js';
import { SettingsService } from '../setting/settings.service.js';
import { ConfigurationResponse, PortalPagesConfigurationDto } from './dto/configuration.dto.js';
import { CustomerService } from '../customer/customer.service.js';
import { CustomerBillingResponse } from './dto/customer.dto.js';
import { InvoiceStatus } from '../invoice/entities/InvoiceStatus.js';
import { InvoiceListItem, ListInvoicesResponse } from './dto/list-invoices.dto.js';
import { ReadSingleInvoiceResponse } from './dto/single-invoice.dto.js';
import { Billing } from '../billing/entities/billing.entity.js';
import { DatetimeUtils } from '../utils/datetime.js';
import { UsageService } from '../usage/usage.service.js';
import {
    AggregatedUsageResponse,
    GetCustomerStripePortalResponse,
    MetadataGroupedAggregatedUsageResponse,
    UnAggregatedUsageResponse,
} from '../customer/dto/read-customer.dto.js';
import { UsageOfCurrentBillingCycle } from './dto/usage.dto.js';
import { UpdatePortalCustomerDto } from './dto/update-customer.dto.js';
import { CreateCustomerOnboarding, CreateCustomerOnboardingResponse } from './dto/createCustomerOnboarding.dto.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { PortalUsageQueryParamDto } from './dto/portalUsageQueryParam.dto.js';
import { PaymentService } from '../payment/payment.service.js';
import { PaymentSessionResponse } from './dto/paymentSessionResponst.dto.js';
import { PaymentTypes } from '../payment/dto/PaymentTypes.js';
import { StripePaymentProcessor } from '../payment/entities/payment.entity.js';
import Stripe from 'stripe';
import { ReadInvoicesDto } from '../invoice/dto/read-invoices.dto.js';
import { ReadOfferingResponseData } from '../offering/dto/readOffering.dto.js';
import { ValidBillingCycles } from '../offering/dto/createOffering.dto.js';

@Injectable()
export class PortalService {
    private static readonly logger = new Logger(PortalService.name);

    constructor(
        readonly invoicesService: InvoicesService,
        readonly settingService: SettingsService,
        readonly customerService: CustomerService,
        readonly usageService: UsageService,
        readonly localJWTAuthService: LocalJWTAuthService,
        readonly paymentService: PaymentService,
    ) {}

    async findInvoice({ businessID, invoiceId, download, customerId }): Promise<ReadSingleInvoiceResponse> {
        const { message, data } = await this.invoicesService.findOne(businessID, invoiceId, download);
        if (!data.length || data[0].customerId !== customerId) {
            throw new NotFoundException(`Invoice ${invoiceId} not found`);
        }

        return { message, data: [{ ...data[0] }] };
    }

    async findInvoices(businessID: string, customerId: string): Promise<ListInvoicesResponse> {
        const invoices = await this.invoicesService.findAll(businessID, customerId, true);
        return {
            message: invoices.length ? 'Found invoices for customer' : 'No invoices found for customer',
            data: invoices.map((invoice) => new InvoiceListItem(invoice)),
        };
    }
    async updateConfiguration({ businessID, subject, ...fields }: PortalPagesConfigurationDto) {
        await this.settingService.update({ businessID, subject, ...fields });
        return { message: 'updated portal configuration' };
    }
    async findConfiguration(businessID: string): Promise<ConfigurationResponse> {
        const latestSetting = await this.settingService.findLatestSetting({ businessID });
        return { message: 'Found portal configuration', logoUrl: latestSetting.logoUrl, pages: latestSetting.pages };
    }

    async findCustomer(businessID: string, customerId: string): Promise<CustomerBillingResponse> {
        const customerReadResponse = await this.customerService.findOne({
            businessID,
            customerId,
            getPaymentInfo: false,
        });
        const customerData = customerReadResponse.data[0];
        return CustomerBillingResponse.from({
            ...customerData,
            invoices: customerData.invoices?.filter(
                (invoice) =>
                    invoice.invoiceStatus !== InvoiceStatus.VOIDED && invoice.invoiceStatus !== InvoiceStatus.DRAFT,
            ),
        });
    }

    async updateCustomer(businessID: string, customerId: string, { address, offeringId }: UpdatePortalCustomerDto) {
        await this.customerService.update({ businessID, address, offeringId }, customerId, customerId);
        return { message: 'Customer updated', customerId };
    }

    async getStripePortalUrl(businessID: string, customerId: string): Promise<GetCustomerStripePortalResponse> {
        return this.customerService.getStripePortalUrl({ businessID, customerId });
    }

    async findUsageOfCurrentBillingCycle(
        businessID: string,
        customerId: string,
        query: PortalUsageQueryParamDto,
    ): Promise<UsageOfCurrentBillingCycle> {
        const {
            data: [customer],
        } = await this.customerService.findOne({ businessID, customerId });
        if (!customer.offering) {
            return {
                message: 'Customer no Offerings found',
                data: [],
            };
        }
        let billingCycleStartTime;
        if (Array.isArray(customer?.offering) && customer?.offering.length > 0) {
            const { currentBillingCycleStartTime } = Billing.billingCycleToTimeRange(ValidBillingCycles.monthly);
            //TODO: Fix this
            billingCycleStartTime = currentBillingCycleStartTime;
        } else {
            const { currentBillingCycleStartTime } = Billing.billingCycleToTimeRange(
                (customer.offering as ReadOfferingResponseData).billingCycle,
            );
            billingCycleStartTime = currentBillingCycleStartTime;
        }

        const startTime = DatetimeUtils.max([billingCycleStartTime, customer.offeringEnrollmentDate]);
        const endTime = new Date().toISOString();

        const aggregatedData = await this.usageService.findUsageForCustomer(
            { businessID, customerId, customer },
            {
                startTime,
                endTime,
                aggregationPurpose: query?.aggregationPurpose ? query.aggregationPurpose : undefined,
            },
        );

        return {
            message: 'Found customer usage data',
            data: (aggregatedData as AggregatedUsageResponse[]).map((aggregatedDimension) => ({
                offeringId: aggregatedDimension.offeringId,
                dimensionId: aggregatedDimension.dimensionId,
                startTime,
                endTime,
                value: `${aggregatedDimension.usage.reduce((acc, current) => acc + parseFloat(current.value), 0)}`,
            })),
        };
    }
    async getPaymentSession(
        businessID: string,
        customerId: string,
        invoiceId: string,
        invoiceData?: ReadInvoicesDto[],
    ): Promise<PaymentSessionResponse> {
        PortalService.logger.log(`Generating payment session for invoice ${invoiceId}`);
        const { data: customerData } = await this.customerService.findOne({ businessID, customerId });
        const settingsRes = await this.settingService.findAll({ businessID });
        let invoiceRes: ReadInvoicesDto[];
        if (invoiceData === undefined) {
            const { data } = await this.invoicesService.findOne(businessID, invoiceId, 'false');
            invoiceRes = data;
        } else {
            invoiceRes = invoiceData;
        }
        PortalService.logger.log(`Found invoice ${invoiceId}`);
        const { url, paymentCompletedAlready } = await this.paymentService.getCheckoutSessionPage({
            customerId,
            businessID,
            customer: customerData[0],
            settings: settingsRes[0],
            amountToPay:
                invoiceRes[0].totalAmountWithoutTax +
                invoiceRes[0].taxAmount -
                (invoiceRes[0].amountPaid ? invoiceRes[0].amountPaid : 0),

            invoiceId,
        });
        PortalService.logger.log(`Payment session url generated for invoice ${invoiceId}`);

        return { message: 'Payment session url generated', url, paymentCompleted: Boolean(paymentCompletedAlready) };
    }

    async handlePaymentSucess({
        invoiceId,
        customerId,
        businessID,
        sessionId,
    }: {
        invoiceId: string;
        customerId: string;
        businessID: string;
        sessionId: string;
    }) {
        // Lookup the stripe session
        const [settings] = await this.settingService.findAll({ businessID });
        const session = await StripePaymentProcessor.getStripeSession({
            sessionId,
            accountState: settings?.accountState,
            stripeAccountId: settings?.stripeAccountId,
        });
        const { payment_intent } = session;
        const { amount, id: pamynetIntentResponseId, created } = payment_intent as Stripe.PaymentIntent;
        await this.paymentService.createAmountPaidTransaction({
            transactionAmount: parseFloat(StripePaymentProcessor.convertStripeAmountToMeteringCo(amount)),
            metadata: {
                paymentIntentId: pamynetIntentResponseId,
                sessionId,
                paymentType: PaymentTypes.STRIPE,
            },
            invoiceId,
            businessID,
            timestamp: new Date(created * 1000).toISOString(),
            customerId,
        });
        // Queue the invoice status checker to check the invoice status and update to paid if necessary
        await this.invoicesService.queueInvoiceStatusChecker({
            businessID,
            invoiceId,
            customerId,
            timesChecked: '0',
        });
        PortalService.logger.log(`Payment success for invoice ${invoiceId}`);
        return;
    }

    async createCustomer(
        customerDto: CreateCustomerOnboarding,
        subject: string,
    ): Promise<CreateCustomerOnboardingResponse> {
        const { customerId, portalUrl } = await this.customerService.create(customerDto, subject);
        const { access_token } = await this.localJWTAuthService.signIn(customerId, customerDto?.businessID);
        return {
            message: 'Customer created',
            customerId,
            portalUrl,
            access_token,
        };
    }
}
