import { ApiProperty } from '@nestjs/swagger';
import {
    IsEnum,
    IsNotEmpty,
    IsNumberString,
    IsObject,
    IsOptional,
    IsString,
    Validate,
    ValidationArguments,
} from 'class-validator';
import { IsNumericStringGreaterThanOrEqualToZeroValidator } from '../../utils/validator.js';

export enum ValidRefundReasons {
    'duplicate' = 'duplicate',
    'fraudulent' = 'fraudulent',
    'requested_by_customer' = 'requested_by_customer',
}

export class StripeRefundChannelOptions {
    /**
     * The paymentIntentId on stripe for the customer. Either paymentIntentId or chargeId is required.
     * <br><br>
     * Example: `"pi_1Gszkg2eZvKYlo2C6ZLlAL7u"`
     * @example "pi_1Gszkg2eZvKYlo2C6ZLlAL7u"
     */
    @IsOptional()
    @IsString()
    paymentIntentId?: string;
}

export class CreateCustomerRefundDto {
    /**
     * The refund amount to be delivered to the customer. Currency is determined by the currency  Only numerical string is allowed.
     * If no amount is specified the full amount of the payment will be refunded.
     * <br><br>
     * Example: `"10.00"` for $10.00.
     * @example "10.00"
     *
     */
    @IsNumberString()
    @IsOptional()
    @Validate(IsNumericStringGreaterThanOrEqualToZeroValidator)
    public amount?: string;

    /**
     * Configuration options for the refund channel.
     * See example below.
     * <br><br>
     * Example `{"paymentIntentId": "pi_1Gszkg2eZvKYlo2C6ZLlAL7u"}`
     */
    @IsObject()
    @IsOptional()
    public refundChannelOptions: StripeRefundChannelOptions;
    /**
     * A stripe platform specific reason enum. Not required, will be defaulted to `"requested_by_customer"`
     * <br><br>
     * Example `"duplicate"`
     * @example "duplicate"
     **/
    @IsEnum(ValidRefundReasons, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `reason: The value ${value} is not a valid value for the reason field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty({
        enum: ValidRefundReasons,
        default: ValidRefundReasons.requested_by_customer,
        externalDocs: {
            url: 'https://stripe.com/docs/api/refunds/create#create_refund-reason',
        },
    })
    public reason?: ValidRefundReasons;
    /**
     * An optional key-value map of additional metadata to associate with this refund.
     * This metadata will be passed to the final refund channel to correlate information between invoices,
     * customers and other platform specific keys.
     * <br><br>
     * Example `{"environment": "staging", "purpose": "Outage reported", "owner": "John Doe", "invoiceId": "123-abc-456"}`
     **/
    @IsObject()
    @IsOptional()
    public metadata?: Record<string, string | number | null>;
}
