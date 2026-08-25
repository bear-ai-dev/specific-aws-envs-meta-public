import { StripePaymentResponseDto } from '../../../src/payment/dto/stripePaymentResponse.dto.js';

export const stripePayment: StripePaymentResponseDto = {
    amount: '123.45',
    paymentIntentsId: 'pi_1J5J1n2eZvKYlo2C0q2Q2Q2Q2',
    metadata: { invoiceId: '539b7f74-3832-474e-a955-6d69c5df12d0' },
    currency: 'usd',
    charges: [
        {
            chargeId: 'ch_12fhaskjc123dfhQFzzz23',
            amount: '123.45',
        },
    ],
    status: 'succeeded',
    created: '021-08-02T20:00:00.000Z',
};
