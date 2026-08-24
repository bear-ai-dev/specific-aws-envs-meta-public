import { SendInvoiceEmail } from '../../setting/dto/update-settings.dto.js';
import { CreditService } from '../../credit/credit.service.js';
import { paymentChannel } from '../../customer/dto/create-customer.dto.js';
import { Invoice } from '../../invoice/entities/invoice.entity.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';

export type PaymentProcessRequest = {
    topic: paymentChannel;
    data: Array<StripePaymentInput>;
};
export type RefundProcessRequest = {
    data: StripeRefundInput;
};

export type StripeRefundInput = {
    stripeCustomerId: string;
    stripeAccountId: string;
    amount?: string;
    accountState?: ReadSettingsResponseData['accountState'];
    reason: string;
    paymentIntentId?: string;
    chargeId?: string;
};
export type StripePaymentInput = {
    stripeCustomerId: string;
    stripeAccountId: string;
    businessID: string;
    customerId: string;
    invoice: Invoice;
    accountState?: ReadSettingsResponseData['accountState'];
};

export type RequiredPaymentServices = {
    creditService: CreditService;
};
export interface PaymentProcessor {
    process: (paymentRequest: PaymentProcessRequest, services: RequiredPaymentServices) => void;
}

export type PaymentResponse = {
    message: string;
    id: string;
    data: Array<any>;
};

export interface Payment {
    publish: (publishRequest: PaymentProcessRequest) => PaymentResponse;
    subscribe: (paymentChannel: paymentChannel, processor: PaymentProcessor) => void;
}
