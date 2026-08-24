import { CreateCustomerResponseDto } from '../../customer/dto/create-customer.dto.js';
import { ReadCustomerResponseData } from '../../customer/entities/customer.entity.js';
import { CreateInvoiceResponseDto } from '../../invoice/dto/create-Invoices.dto.js';
import { ReadInvoicesDto } from '../../invoice/dto/read-invoices.dto.js';
import { StripePaymentResponseDto } from '../../payment/dto/stripePaymentResponse.dto.js';
import { WebhookType } from '../dto/create-webhook.dto.js';
import { WebhookProcessorEventType } from '../webhook.service.js';
import { EntitlementWebookParameters } from './webhook.entity.js';

export type WebhookProcessorRequestData =
    | ReadInvoicesDto
    | ReadCustomerResponseData
    | StripePaymentResponseDto
    | (CreateInvoiceResponseDto & { customerId?: string; offeringIds?: string[] })
    | EntitlementWebookParameters;

export type WebhookProcessorRequest = {
    topic: WebhookProcessorEventType;
    data: WebhookProcessorRequestData[];
    type: WebhookType;
    businessID: string;
};

export interface WebhookProcessorInterface {
    process: (publishRequest: WebhookProcessorRequest) => void;
}
