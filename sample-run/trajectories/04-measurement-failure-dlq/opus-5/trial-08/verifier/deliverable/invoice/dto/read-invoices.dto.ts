import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUrl, IsUUID } from 'class-validator';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Invoice, InvoiceLineItem, InvoiceRefunds } from '../entities/invoice.entity.js';
import { InvoiceStatus } from '../entities/InvoiceStatus.js';
import { InvoicePaymentTerm } from '../entities/InvoicePaymentTerm.js';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';
import { ReadPaymentDto } from '../../payment/dto/readPayment.dto.js';

export class ReadInvoicesDto {
    @IsUUID()
    @ApiHideProperty()
    public invoiceId: string;

    /**
     * The invoice status
     * <br><br>
     *
     * Example: `"Draft"`
     * @example "Draft"
     */
    @IsEnum(InvoiceStatus)
    @ApiProperty({
        enum: InvoiceStatus,
        externalDocs: {
            url: 'https://docs.meteringco.example/invoice-and-process-payment/issue-invoice',
            description: 'See Invoice Life Cycle section for more details',
        },
    })
    @IsOptional()
    public invoiceStatus: InvoiceStatus;

    /**
     * The payment term for the invoice
     * <br><br>
     * Example: `"30"`
     * @example "30"
     */
    @IsString()
    @ApiProperty()
    @IsOptional()
    public invoicePaymentTerm: InvoicePaymentTerm;

    /**
     * The date the invoice was issued
     * <br><br>
     * Example: `"2021-01-01T00:00:00.000Z"`
     * @example "2021-01-01T00:00:00.000Z"
     *
     */
    @IsDateString()
    @ApiProperty()
    @IsOptional()
    public invoiceDate: string;

    /**
     * The unique identifier assigned by MeteringCo for the customer
     * <br><br>
     * Example: `"e962aefe-6134-4f28-8967-a11cfe7f0bf2"`
     * @example "e962aefe-6134-4f28-8967-a11cfe7f0bf2"
     */
    @IsUUID()
    @ApiProperty()
    @IsOptional()
    public customerId?: string;

    /**
     * The total amount of the invoice without tax
     * <br><br>
     * Example: `100.00`
     * @example 100.00
     *
     */
    @IsNumber()
    @ApiProperty()
    @IsOptional()
    public totalAmountWithoutTax: number;

    /**
     * The total amount of tax on the invoice
     * <br><br>
     * Example: `10.00`
     * @example 10.00
     *
     */
    @IsNumber()
    @ApiProperty()
    @IsOptional()
    public taxAmount?: number;

    /**
     * The total amount paid by the customer so far for the invoice
     * <br><br>
     * Example: `110.00`
     * @example 110.00
     *
     */
    @IsNumber()
    @ApiProperty()
    @IsOptional()
    public amountPaid?: number;

    /**
     * The URL to download the invoice. URLs are self signed and valid for 7 days after the link is generated.
     * <br><br>
     * Example: `"https://my-cool-bucket.s3.amazonaws.com/invoices/123MyCoolCorp980/2021-01-01/123MyCoolCorp980-2021-01-01-1234567890.pdf"`
     * @example "https://my-cool-bucket.s3.amazonaws.com/invoices/123MyCoolCorp980/2021-01-01/123MyCoolCorp980-2021-01-01-1234567890.pdf"
     */
    @IsUrl()
    @ApiProperty()
    @IsOptional()
    public invoiceUrl?: string;

    /**
     * The line items on the invoice
     */
    @IsArray()
    public lineItems: InvoiceLineItem[];

    /**
     * The refunds associated with the invoice
     */
    @IsArray()
    public refunds: Array<InvoiceRefunds>;

    /**
     * The payments associated with the invoice
     */
    @IsArray()
    public payments: Array<ReadPaymentDto>;

    /**
     * The currency of the invoice. Defaults to USD
     * <br><br>
     * Example: `"USD"`
     * @example "USD"
     */
    @ApiProperty()
    @IsOptional()
    @IsEnum(SupportedCurrencies)
    public currency: SupportedCurrencies;

    /**
     * The payment link for the invoice. Only used for invoices in the `Draft` or `Open` status. Otherwise this field will not be present.
     * <br><br>
     * Example: `"https://example.com/redirect"`
     * @example "https://example.com/redirect"
     */
    @ApiProperty()
    @IsOptional()
    public paymentLink?: string;

    constructor(invoice: Invoice, invoiceUrl?: string) {
        this.invoiceId = invoice.invoiceId;
        this.invoiceStatus = invoice.invoiceStatus;
        this.invoiceDate = invoice.invoiceDate.toISOString();
        this.customerId = invoice.customerId;
        this.totalAmountWithoutTax = invoice.totalAmountWithoutTax;
        this.taxAmount = invoice.taxAmount;
        this.amountPaid = invoice.amountPaid;
        this.currency = invoice.currency;
        if (invoiceUrl) {
            this.invoiceUrl = invoiceUrl;
        }
        if (invoice.invoiceLineItems) {
            this.lineItems = invoice.invoiceLineItems.getLineItems().map((lineItem) => ({
                ...lineItem,
                unitCost: ReadInvoicesDto.cutoffDigits(lineItem.unitCost),
                quantity: ReadInvoicesDto.cutoffDigits(lineItem.quantity),
            }));
        }
        if (invoice.invoicePaymentTerm) {
            this.invoicePaymentTerm = invoice.invoicePaymentTerm;
        }
        if (invoice?.paymentLink) {
            this.paymentLink = invoice.paymentLink;
        }
        this.refunds = invoice.refunds;
        this.payments = invoice.payments;
    }
    static cutoffDigits(value: number): number {
        // Determine the number of digits after the decimal point

        const digits = value.toString().split('.')[1]?.length || 0;
        // If there are more than 8 digits after the decimal point, round to 8 digits
        if (digits > 8) {
            return parseFloat(value.toFixed(8));
        }
        return value;
    }
}

export class ReadInvoicesResponse extends BasicResponseDTO {
    public data: ReadInvoicesDto[];
}
