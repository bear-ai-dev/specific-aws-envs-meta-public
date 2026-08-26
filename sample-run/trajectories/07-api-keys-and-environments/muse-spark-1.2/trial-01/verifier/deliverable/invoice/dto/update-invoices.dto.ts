import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { InvoiceLineItem, InvoiceLineItems } from '../entities/invoice.entity.js';
import { InvoiceStatus } from '../entities/InvoiceStatus.js';
import { InvoicePaymentTerm } from '../entities/InvoicePaymentTerm.js';
import { Type } from 'class-transformer';

export class UpdateInvoicesDto {
    /**
     * The ID for the Business Entity using MeteringCo
     * @example 123MyCoolCorp980
     */
    @IsString()
    @ApiHideProperty()
    @IsOptional()
    public businessID: string;

    @IsUUID()
    @ApiHideProperty()
    @IsOptional()
    public invoiceId: string;

    /**
     * The invoice status, can be one of the following:
     * "Draft", "Open", "Paid", "Voided". Moving an invoice from Draft to Open will trigger payment and email logic associated with the customer's account.
     */
    @IsEnum(InvoiceStatus)
    @ApiProperty()
    @IsOptional()
    public invoiceStatus: InvoiceStatus;

    /**
     * The invoice line items on the invoice, can only be updated in for invoices in"Draft" status.
     */
    @ApiProperty()
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => InvoiceLineItem)
    public lineItems?: InvoiceLineItem[];

    @IsEnum(InvoicePaymentTerm)
    @IsOptional()
    @ApiProperty()
    public invoicePaymentTerm?: InvoicePaymentTerm;

    /**
     * The date the invoice is to be generated for
     */
    @IsOptional()
    @IsDateString()
    @ApiProperty()
    public invoiceDate?: string;
}
