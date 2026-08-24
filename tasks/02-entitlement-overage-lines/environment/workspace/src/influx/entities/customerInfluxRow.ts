import { TaxExempt } from '../../customer/dto/TaxExempt';
import { paymentChannel } from '../../customer/dto/create-customer.dto';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies';
import { BaseInfluxTable } from './baseInfluxTable.entity';

export class CustomerInfluxRow extends BaseInfluxTable {
    declare _value: string;
    customerId: string;
    paymentChannel: paymentChannel;
    email: string;
    address?: string;
    customerVatId?: string;
    taxExempt?: TaxExempt;
    offeringId?: string;
    freeTrialEndDate?: string;
    currency?: SupportedCurrencies;
    creditBalance?: string;
    freeTrialStartDate?: string;
    offeringEnrollmentDate?: string;
    metadata?: string;
    businessID: string;
    offeringIds?: string;
    [key: string]: string | number;
}
