import { CreateCustomerDto, paymentChannel } from '../../customer/dto/create-customer.dto.js';
import { CustomerEntity } from '../../customer/entities/customer.entity.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';

export class CreatePaymentDto {
    public customerId: CreateCustomerDto['customerId'];
    public businessID: string;
    public paymentChannelOptions: CustomerEntity['paymentChannelOptions'];
    public paymentChannel: paymentChannel;
    public total: number;
    public currency: SupportedCurrencies;
    public invoiceId: string;
}

export class AmountPaidTransaction {
    public transactionAmount: number;
    public metadata?: Record<string, string>;
    public invoiceId: string;
    public customerId: string;
    public businessID: string;
    public timestamp?: string;
}
