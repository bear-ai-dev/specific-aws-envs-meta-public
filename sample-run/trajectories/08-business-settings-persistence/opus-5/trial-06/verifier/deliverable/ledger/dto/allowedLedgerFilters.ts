import { InvoiceStatus } from '../../invoice/entities/InvoiceStatus';
import { paymentChannel } from '../../customer/dto/create-customer.dto';

export const ALLOWED_FILTERS = {
    INVOICE: {
        invoiceStatus: [InvoiceStatus.DRAFT, InvoiceStatus.PAID, InvoiceStatus.VOIDED, InvoiceStatus.OPEN],
    },
    CUSTOMER: {
        customerId: true,
        offeringId: true,
        paymentChannel: [paymentChannel.Stripe, paymentChannel.manual],
    },
    ENROLLMENT: {
        offeringId: true,
        customerId: true,
    },
    CUSTOMERGROUPS: {
        parentId: true,
        groupId: true,
    },
    CHIDLROW: {
        parentId: true,
        childId: true,
    },
};
