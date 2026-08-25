import { ApiProperty } from '@nestjs/swagger';

export class StripeRefundResponseDto {
    /**
     * The amount of the payment that was refunded. Derived from the stripe "amount_refunded" field.
     * <br><br>
     * Example: `"100.00"`
     * @example "100.00"
     */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/refunds/retrieve',
            description: 'Stripe API Reference: Retrieve a Refund',
        },
    })
    amountRefunded: string;
    /**
     *
     * The amount of the original charge. Derived from the stripe "amount" field.
     * <br><br>
     * Example: `"100.00"`
     * @example "100.00"
     */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/refunds/retrieve',
            description: 'Stripe API Reference: Retrieve a Refund',
        },
    })
    amount: string;

    /**
     * The id of the charge that was refunded. Pass through from Stripe API.
     * <br><br>
     * Example: `"ch_1J5J1n2eZvKYlo2C0q2Q2Q2Q2"`
     * @example "ch_1J5J1n2eZvKYlo2C0q2Q2Q2Q2"
     */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/refunds/retrieve',
            description: 'Stripe API Reference: Retrieve a Refund',
        },
    })
    chargeId: string;

    /**
     * The metadata associated with the refund. Pass through from Stripe API. Metadata is an object of key value pairs.
     * <br><br>
     * Example: `{ "key": "value" }`
     * @example { "key": "value" }
     */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/refunds/retrieve',
            description: 'Stripe API Reference: Retrieve a Refund',
        },
    })
    metadata: Record<string, string>;

    /**
     * The currency associated with the refund. Pass through from Stripe API.
     * <br><br>
     * Example: `"usd"`
     * @example "usd"
     */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/refunds/retrieve',
            description: 'Stripe API Reference: Retrieve a Refund',
        },
    })
    currency: string;

    /**
     * The status of the refund. Pass through from Stripe API.
     * <br><br>
     * Example: `"succeeded"`
     * @example "succeeded"
     */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/refunds/retrieve',
            description: 'Stripe API Reference: Retrieve a Refund',
        },
    })
    status: string;

    /**
     * The ISO representation of the date the refund was created. Derived from the Stripe APIs unix time.
     * <br><br>
     * Example: `"2021-08-02T20:00:00.000Z"`
     * @example "2021-08-02T20:00:00.000Z"
     */
    created?: string;
}
