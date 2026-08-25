import { BaseInfluxTable } from './baseInfluxTable.entity.js';
import {
    ArchiveCostSource,
    ComputeCostSource,
    InvoiceGeneration,
    SendInvoiceEmail,
    StorageCostSource,
} from '../../setting/dto/update-settings.dto.js';
import { InvoiceApproval } from '../../setting/dto/InvoiceApproval.js';
import { TaxCalculationType } from '../../setting/dto/TaxCalculationType.js';
import { InvoicePaymentTerm } from '../../invoice/entities/InvoicePaymentTerm.js';
import { StripeConnected } from '../../setting/entities/settings.entity.js';
import { AccountState } from '../../setting/entities/AccountState.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';

export class SettingInfluxRow extends BaseInfluxTable {
    public static _measurement = 'Setting';

    public taxRate?: string;

    public addressLine1?: string;

    public addressLine2?: string;

    public city?: string;

    public state?: string;

    public country?: string;

    public postalCode?: string;

    public vatId?: string;

    public invoicePaymentTerm?: InvoicePaymentTerm;

    public customFields?: string;

    public logoUrl?: string;

    public taxCategory?: string;

    public taxCalculationType?: TaxCalculationType;

    public businessID: string;

    public stripeAccountId?: string;

    public taxJarApiKey?: string;

    public archiveCostSource?: ArchiveCostSource;

    public computeCostSource?: ComputeCostSource;

    public storageCostSource?: StorageCostSource;

    public stripeConnected?: StripeConnected;

    public accountState?: AccountState;

    public invoiceApproval?: InvoiceApproval;

    public freeDimensionOnInvoice?: FreeDimensionOnInvoice;

    public invoiceGeneration?: InvoiceGeneration;

    public sendInvoiceEmail?: SendInvoiceEmail;

    public pages?: string;

    public cloudIAM?: string;

    public supportEmail?: string;

    public redirectionUrl?: string;

    public declare _value: string;

    public declare _field: string;
}
