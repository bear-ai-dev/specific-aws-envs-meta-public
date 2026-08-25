import { ReadInvoicesDto } from '../../invoice/dto/read-invoices.dto.js';
import { ApiProperty, PickType } from '@nestjs/swagger';
import { Invoice } from '../../invoice/entities/invoice.entity.js';
import { BasicResponseDTO } from '../../basicResponseDTO.js';

export class InvoiceListItem extends PickType(ReadInvoicesDto, [
    'invoiceDate',
    'taxAmount',
    'totalAmountWithoutTax',
    'paymentLink',
]) {
    /**
     * The unique identifier for the invoice
     * <br><br>
     * Example: `"e962aefe-6134-4f28-8967-a11cfe7f0bf2"`
     * @example "e962aefe-6134-4f28-8967-a11cfe7f0bf2"
     *
     */
    @ApiProperty()
    public invoiceId: string;

    /**
     * The total amount of the invoice = taxAmount + totalAmountWithoutTax
     * <br><br>
     * Example: `110.00`
     * @example 110.00
     *
     */
    @ApiProperty()
    public totalAmount: number;

    constructor(invoice: Invoice) {
        super();
        this.invoiceId = invoice.invoiceId;
        this.invoiceDate = invoice.invoiceDate.toISOString();
        this.taxAmount = invoice.taxAmount;
        this.totalAmountWithoutTax = invoice.totalAmountWithoutTax;
        this.totalAmount = invoice.total;
        if (invoice.paymentLink) {
            this.paymentLink = invoice.paymentLink;
        }
    }
}

export class ListInvoicesResponse extends BasicResponseDTO {
    data: InvoiceListItem[];
}
