import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsRFC3339, IsString } from 'class-validator';
import { ApiHideProperty, ApiProperty, OmitType } from '@nestjs/swagger';
import { InvoicePaymentTerm } from '../entities/InvoicePaymentTerm.js';
import { StartTimeRangeValidation } from './timeRangeValidator.js';
import { InvoiceLineItemValidation, ManualInvoiceValidation } from './manualInvoiceValidation.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';
import { ReadCustomerResponseData } from '../../customer/entities/customer.entity.js';
import { InvoiceLineItems, InvoiceLineItem } from '../entities/invoice.entity.js';

export class CreateInvoicesDto {
    /**
     * The ID for the Business Entity using MeteringCo
     * @example 123MyCoolCorp980
     */

    @IsString()
    @ApiHideProperty()
    @IsOptional()
    public businessID: string;

    /**
     *
     * The client ID assocaited with the Business Entity, this is the name for the business which will be used in the invoce
     * <br><br>
     * Example: `"Khols"`
     * @example Khols
     */

    @IsString()
    @IsNotEmpty()
    @ApiProperty()
    public customerId: string;

    /**
     *
     * The Itemized collection of elements to be billed. These could be instance compute hours, or number of users
     * <br><br>
     * Example: `[{ "name": "MyService", "quantity": 1, "unitCost": 100.09 }]`
     */

    @ManualInvoiceValidation('items')
    @InvoiceLineItemValidation('items')
    @ApiProperty({
        isArray: true,
        type: 'object',
        example: [{ name: 'MeteringCo Pro', quantity: 1, unitCost: 100.09 }],
    })
    public items: Array<any> | InvoiceLineItems;

    /**
     * The date the invoice is to be generated for
     * <br><br>
     * Example: `"2020-09-18T17:34:02.666Z"`
     * @example "2020-09-18T17:34:02.666Z"
     */
    @IsOptional()
    @IsDateString()
    @ApiProperty()
    public invoiceDate?: string;

    /**
     * The currency the invoice is to be generated in. If no Currency is passed in the currency used by the customer will be used.
     * <br><br>
     * Example: `"EUR"`
     * @example "EUR"
     *
     */
    @IsOptional()
    @ApiProperty({ enum: SupportedCurrencies })
    public currency?: SupportedCurrencies;

    /**
     *
     * The Payment Term for the invoice. This is the number of days until the invoice is considered past due. Default is "none". String `""` represents "none".
     * <br><br>
     * Example: `"30"`
     * @example '"30"'
     */
    @IsEnum(InvoicePaymentTerm)
    @IsOptional()
    @ApiProperty()
    public invoicePaymentTerm?: InvoicePaymentTerm;

    /**
     * The start time the invoice is to be generated for, if not provided the first day of the current month (UTC) will be used
     * <br><br>
     * Example: `"2020-09-01T13:37:00.000Z"`
     * @example '2020-09-01T13:37:00.000Z'
     */
    @IsRFC3339()
    @IsOptional()
    @StartTimeRangeValidation('start')
    @ApiHideProperty()
    public start?: string;

    /**
     * The end time the invoice is to be generated for, if not provided now in UTC will be used. <br><br>  <i> If provided EndTime must be after startTime and must also be after the first day of the current month </i>
     * <br><br>
     * Example: `"2020-09-18T17:34:02.666Z"`
     * @example '2020-09-18T17:34:02.666Z'
     */
    @IsRFC3339()
    @IsOptional()
    @ApiHideProperty()
    public end?: string;

    @IsOptional()
    @ApiHideProperty()
    public offeringId?: string;
}

/*
 To be used when the customer is first created. Since its possible that the customer object is not in the database yet. 
 Additionally can be used to reduce the number of calls to the DB for the same information.
*/
export class CustomerInvoiceDto extends OmitType(CreateInvoicesDto, ['customerId']) {
    customer?: ReadCustomerResponseData;
}

export class CreateInvoiceResponseDto {
    invoiceId: string;
    message: string;
}
