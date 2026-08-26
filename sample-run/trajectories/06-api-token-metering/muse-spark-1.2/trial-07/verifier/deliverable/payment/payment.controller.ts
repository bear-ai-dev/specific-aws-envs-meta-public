import { Controller } from '@nestjs/common';
import { PaymentService } from './payment.service.js';

@Controller('payment')
export class PaymentController {
    constructor(private readonly paymentService: PaymentService) {}
}
