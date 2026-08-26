import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsRFC3339, IsString } from 'class-validator';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';
import { InvoicePaymentTerm } from '../entities/InvoicePaymentTerm.js';
import { StartTimeRangeValidation } from './timeRangeValidator.js';

export class GenerateOffCycleDto {
    /**
     *
     * The client ID assocaited with the Business Entity, this is the name for the business which will be used in the invoce
     * @example Khols
     */
    @IsString()
    @IsNotEmpty()
    @ApiProperty({ name: 'customerId', required: true })
    public customerId: string;

    /**
     *
     * The Payment Term for the invoice. This is the number of days until the invoice is considered past due. Default is "none"
     * @example "net30"
     */
    @IsEnum(InvoicePaymentTerm)
    @IsOptional()
    @ApiProperty({
        name: 'invoicePaymentTerm',
        required: false,
        description:
            "The Payment Term for the invoice. This is the number of days until the invoice is considered past due. Default is 'none'",
        enum: InvoicePaymentTerm,
    })
    public invoicePaymentTerm?: InvoicePaymentTerm;

    @ApiHideProperty()
    @IsOptional()
    public businessID?: string;

    @IsRFC3339()
    @IsOptional()
    @StartTimeRangeValidation('startTime')
    @ApiProperty({
        name: 'start',
        required: false,
        example: '2020-09-01T13:37:00.000Z',
        description:
            'The start time the invoice is to be generated for, if not provided the first day of the current month (UTC) will be used',
    })
    public start?: string;

    @IsRFC3339()
    @IsOptional()
    @ApiProperty({
        name: 'end',
        required: false,
        example: '2020-09-18T17:34:02.666Z',
        description:
            'The end time the invoice is to be generated for, if not provided now in UTC will be used. <br><br>  <i> If provided EndTime must be after startTime and must also be after the first day of the current month </i>',
    })
    public end?: string;

    /**
     * The date the invoice is to be generated for
     * @example "2020-09-18T17:34:02.666Z"
     */
    @IsOptional()
    @IsDateString()
    @ApiProperty()
    public invoiceDate?: string;

    @IsOptional()
    @ApiHideProperty()
    public offeringId?: string;
}
