import { IsNotEmpty, IsNumberString, IsString } from 'class-validator';

export class InvoiceStatusCheckerDto {
    @IsString()
    @IsNotEmpty()
    public invoiceId: string;

    @IsString()
    @IsNotEmpty()
    public customerId: string;

    @IsString()
    @IsNotEmpty()
    public businessID: string;

    @IsNumberString()
    @IsNotEmpty()
    public timesChecked: string;
}
