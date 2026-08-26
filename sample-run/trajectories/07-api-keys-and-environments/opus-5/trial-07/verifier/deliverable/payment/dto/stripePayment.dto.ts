import { ApiHideProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { AccountState } from '../../setting/entities/AccountState.js';

export enum currency {
    usd = 'usd',
    eur = 'eur',
    cny = 'cny',
}
export class StripePaymentDto {
    /**
     * The unique identifier for the SaaS business
     * @example HarperDB
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID: string;

    /**
     * The amount owed to the saas business
     * @example 1000
     */
    @IsNumber()
    public amount: number;

    /**
     * The currency associated with the stripe
     * @example usd
     */
    @IsEnum(currency)
    public currency: currency;

    /**
     * The customer id, as it appears in stripe
     * @example cust_abc123
     */
    @IsString()
    public stripeCustomerId: string;

    /**
     * The Account ID of the linked business account in stripe
     * @example  ac_1234abc
     */
    @IsString()
    public stripeAccountId: string;

    /**
     *
     * The account state associated with the stripe account.
     * <br><br>
     * Example: `"sandbox"`
     * @example "sandbox"
     * @example "production"
     *
     *
     **/
    @ApiHideProperty()
    public accountState: AccountState;
    /**
     * The invoiceId associated with the stripe payment. Can be undefined.
     */
    @IsString()
    @IsOptional()
    public invoiceId?: string;
}
