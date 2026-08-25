import { ApiProperty } from '@nestjs/swagger';

export class StripePaymentResponseDto {
    /**
     * The amount of the payment that was recieved from the customer. Pass through from Stripe API. Represeted as the lowest denomination of the currency.
     * <br><br>
     * Example: `"100.12"`
     * @example "100.12"
     */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/payment_intents/retrieve',
            description: 'Stripe API Reference: Retrieve a Payment Intent',
        },
    })
    amount: string;

    /**
     * The id of the payment intent that was created. Pass through from Stripe API.
     * <br><br>
     * Example: `pi_1J5J1n2eZvKYlo2C0q2Q2Q2Q2`
     * @example pi_1J5J1n2eZvKYlo2C0q2Q2Q2Q2
     * */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/payment_intents/retrieve',
            description: 'Stripe API Reference: Retrieve a Payment Intent',
        },
    })
    paymentIntentsId: string;

    /**
     * The metadata associated with the payment intent. Pass through from Stripe API. Metadata is an object of key value pairs.
     * <br><br>
     * Example: `{ "key": "value" }`
     * @example { "key": "value" }
     * */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/payment_intents/retrieve',
            description: 'Stripe API Reference: Retrieve a Payment Intent',
        },
    })
    metadata: Record<string, string>;

    /**
     *  The currency associated with the payment intent. Pass through from Stripe API.
     *
     *  <br><br>
     * Example: `usd`
     * @example usd
     * */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/payment_intents/retrieve',
            description: 'Stripe API Reference: Retrieve a Payment Intent',
        },
    })
    currency: string;

    /**
     * The status of the payment intent. Non succeeded responses indicate there may be additional followon actions required. Pass through from Stripe API.
     * <br><br>
     * Example: `succeeded`
     *
     * @example succeeded
     * */
    @ApiProperty({
        externalDocs: {
            url: 'https://stripe.com/docs/api/payment_intents/retrieve',
            description: 'Stripe API Reference: Retrieve a Payment Intent',
        },
    })
    status: string;

    /**
     * The ISO representation of the date the payment intent was created. Derived from the Stripe APIs unix time.
     * <br><br>
     * Example: `2021-08-02T20:00:00.000Z`
     * @example 2021-08-02T20:00:00.000Z
     * */
    created?: string;

    /**
     * An array of charges associated with the payment intent. Pass through from Stripe API. Can be empty in cases where the payment intent has not been fulfilled.
     * There can additionally be many charges for a single payment intent. See Stripe Docs for more information
     */
    @ApiProperty({
        minimum: 0,
    })
    charges: Array<ChargeResponseDto>;
}

export class ChargeResponseDto {
    /**
     * The id of the charge. Pass through from Stripe API.
     * <br><br>
     * Example: `ch_12fhaskjc123dfhQFzzz23`
     * @example ch_12fhaskjc123dfhQFzzz23
     */
    chargeId: string;

    /**
     * The amount of the charge. Pass through from Stripe API. Represeted as the lowest denomination of the currency.
     * <br><br>
     * Example: `"100.12"`
     * @example "100.12"
     * */
    amount: string;
}
