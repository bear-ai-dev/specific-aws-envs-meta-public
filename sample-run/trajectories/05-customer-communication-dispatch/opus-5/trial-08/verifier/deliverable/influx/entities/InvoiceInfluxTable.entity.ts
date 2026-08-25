import { BaseInfluxTable } from './baseInfluxTable.entity.js';
import { InvoiceStatus } from '../../invoice/entities/InvoiceStatus.js';
import { InvoicePaymentTerm } from '../../invoice/entities/InvoicePaymentTerm.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';

export class InvoiceInfluxRow extends BaseInfluxTable {
    public static _measurement = 'Invoice';

    public businessID: string;

    public invoiceId: string;

    public invoiceStatus: InvoiceStatus;

    public invoiceS3bucket?: string;

    public invoiceS3key?: string;

    public invoiceDate: string;

    public totalAmountWithoutTax?: number;

    public taxAmount?: number;

    public customerId: string;

    public invoicePaymentTerm: InvoicePaymentTerm;

    public invoiceLineItems: string;

    public invoiceLineItemTerms: string;

    public salesTaxRate?: string;

    public currency: SupportedCurrencies;

    public fromEntity?: string;

    public toEntity?: string;

    public isManual?: string;

    public declare _value: string;

    public declare _field: string;
}
