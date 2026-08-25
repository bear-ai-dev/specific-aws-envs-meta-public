import { InvoiceStatus } from '../../../src/invoice/entities/InvoiceStatus.js';
import { InvoicePaymentTerm } from '../../../src/invoice/entities/InvoicePaymentTerm.js';
import { SupportedCurrencies } from '../../../src/offering/dto/SupportedCurrencies.js';
import { stripePayment } from './payment.js';

export const draftInvoice = {
    invoiceId: 'draft-invoice-id',
    businessID: 'some-business-id',
    customerId: 'e345f409-daca-4144-91d2-0a0f87c96581',
    invoiceStatus: InvoiceStatus.DRAFT,
    invoicePaymentTerm: InvoicePaymentTerm.net30,
    invoiceDate: '2021-01-01T00:00:00.000Z',
    totalAmountWithoutTax: 200,
    taxAmount: 20,
    invoiceUrl:
        'https://my-cool-bucket.s3.amazonaws.com/invoices/123MyCoolCorp980/2021-01-01/123MyCoolCorp980-2021-01-01-1234567890.pdf',
    currency: SupportedCurrencies.EUR,
    lineItems: [],
};

export const voidedInvoice = {
    invoiceId: 'voided-invoice-id',
    businessID: 'some-business-id',
    customerId: 'e345f409-daca-4144-91d2-0a0f87c96582',
    invoiceStatus: InvoiceStatus.VOIDED,
    invoicePaymentTerm: InvoicePaymentTerm.net30,
    invoiceDate: '2021-01-01T00:00:00.000Z',
    totalAmountWithoutTax: 300,
    taxAmount: 30,
    invoiceUrl:
        'https://my-cool-bucket.s3.amazonaws.com/invoices/123MyCoolCorp980/2021-01-01/123MyCoolCorp980-2021-01-01-1234567890.pdf',
    currency: SupportedCurrencies.EUR,
    lineItems: [],
};

export const openedInvoice = {
    invoiceId: 'opened-invoice-id',
    businessID: 'some-business-id',
    customerId: 'e345f409-daca-4144-91d2-0a0f87c96583',
    invoiceStatus: InvoiceStatus.OPEN,
    invoicePaymentTerm: InvoicePaymentTerm.net30,
    invoiceDate: '2021-01-01T00:00:00.000Z',
    totalAmountWithoutTax: 100,
    taxAmount: 10,
    invoiceUrl:
        'https://my-cool-bucket.s3.amazonaws.com/invoices/123MyCoolCorp980/2021-01-01/123MyCoolCorp980-2021-01-01-1234567890.pdf',
    currency: SupportedCurrencies.EUR,
    lineItems: [
        {
            description: 'Cool Corp Compute',
            name: 'Compute Hours',
            quantity: 1,
            unitCost: 100.0,
        },
    ],
    payments: [],
};
export const paidInvoice = {
    invoiceId: 'paid-invoice-id',
    businessID: 'some-business-id',
    customerId: 'e345f409-daca-4144-91d2-0a0f87c96584',
    invoiceStatus: InvoiceStatus.PAID,
    invoicePaymentTerm: InvoicePaymentTerm.net30,
    invoiceDate: '2021-02-01T00:00:00.000Z',
    totalAmountWithoutTax: 200,
    taxAmount: 20,
    invoiceUrl:
        'https://my-cool-bucket.s3.amazonaws.com/invoices/123MyCoolCorp980/2021-01-01/123MyCoolCorp980-2021-01-01-1234567890.pdf',
    currency: SupportedCurrencies.EUR,
    lineItems: [
        {
            description: 'Cool Corp Compute',
            name: 'Compute Hours',
            quantity: 2,
            unitCost: 100.0,
        },
    ],
    payments: [stripePayment],
};

export const paidInvoiceInfluxRow = {
    _measurement: 'invoice',
    _time: '2021-02-01T00:00:00.000Z',
    _value: 'paid-invoice-id',
    _field: 'invoiceId',
    businessID: 'some-business',
    invoiceId: 'paid-invoice-id',
    customerId: 'e345f409-daca-4144-91d2-0a0f87c96584',
    invoiceStatus: InvoiceStatus.PAID,
    invoicePaymentTerm: InvoicePaymentTerm.net30,
    invoiceDate: '2021-02-01T00:00:00.000Z',
    totalAmountWithoutTax: '200',
    taxAmount: '20',
    currency: SupportedCurrencies.USD,
    lineItems: JSON.stringify([
        {
            description: 'Cool Corp Compute',
            name: 'Compute Hours',
            quantity: 2,
            unitCost: 100.0,
        },
    ]),
};

export const paidInvoiceInfluxRowGenerator = ({
    invoiceTotal,
    lineItems,
    customerId,
    invoiceId,
}: {
    invoiceTotal: string;
    lineItems: string;
    customerId: string;
    invoiceId: string;
}) =>
    JSON.parse(
        JSON.stringify({
            ...paidInvoiceInfluxRow,
            totalAmountWithoutTax: invoiceTotal,
            lineItems,
            customerId,
            invoiceId,
        }),
    );
