import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO';

export class PaymentSessionResponse extends BasicResponseDTO {
    /**
     * The URL to be used to redirect the customer to the payment page
     * <br><br>
     * Example: `"https://example.com/redirect`
     * @example "https://example.com/redirect"
     */
    @ApiProperty()
    public url: string;

    /**
     * A boolean value for whether the payment has been completed, if true the payment has been completed.
     * <br><br>
     * Example: `true`
     * @example true
     */
    @ApiProperty()
    public paymentCompleted: boolean;
}
