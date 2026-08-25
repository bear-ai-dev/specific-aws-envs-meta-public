import { ReadTransactionLedger } from '../../credit/dto/readCreditBalance.dto.js';
import { PaymentResponseTypes } from './PaymentResponseTypes.js';
import { StripePaymentResponseDto } from './stripePaymentResponse.dto.js';
export class ReadPaymentDto {
    /**
     * The type of payment. Currently only `Credit` and `Stripe` are supported.
     * <br><br>
     * Example: `"Credit"`
     * @example "Credit"
     */
    public type: PaymentResponseTypes;
    /**
     * The amount associated with a specific credit transaction
     * <br><br>
     * Example: `"100.00"`
     * @example "100.00"
     */
    public transactionAmount: string;

    /**
     * The timestamp associated with a specific credit transaction. RFC3339 format.
     * <br><br>
     * Example: `"2021-01-01T00:00:00.000Z"`
     * @example "2021-01-01T00:00:00.000Z"
     */
    public timestamp: string;
    /**
     * The metadata associated with a specific transaction. For `stripe` type responses, paymentIntentsId, currency, and status are included.
     * <br><br>
     * Example: `{"key": "value"}`
     * @example {"key": "value"}
     */
    public metadata: Record<string, string | object | Array<string> | Array<object>>;
    constructor(paymentInfo: ReadTransactionLedger | StripePaymentResponseDto) {
        //eslint-disable-next-line
        //@ts-ignore
        if (paymentInfo?.timestamp) {
            this.type = PaymentResponseTypes.Credit;
            //eslint-disable-next-line
            //@ts-ignore
            this.timestamp = paymentInfo.timestamp.toISOString();
            this.metadata = paymentInfo?.metadata;
            //eslint-disable-next-line
            //@ts-ignore
            this.transactionAmount = Math.abs(paymentInfo.transactionAmount).toFixed(2);
        }
        //eslint-disable-next-line
        //@ts-ignore
        if (paymentInfo?.created) {
            const stripePaymentInfo = paymentInfo as StripePaymentResponseDto;
            this.type = PaymentResponseTypes.Stripe;
            //eslint-disable-next-line
            //@ts-ignore
            this.timestamp = paymentInfo.created;
            this.metadata = {
                ...stripePaymentInfo.metadata,
                paymentIntentsId: stripePaymentInfo.paymentIntentsId,
                currency: stripePaymentInfo?.currency,
                status: stripePaymentInfo?.status,
                charges: stripePaymentInfo?.charges,
            };
            //eslint-disable-next-line
            //@ts-ignore
            this.transactionAmount = paymentInfo.amount;
        }
    }
}
