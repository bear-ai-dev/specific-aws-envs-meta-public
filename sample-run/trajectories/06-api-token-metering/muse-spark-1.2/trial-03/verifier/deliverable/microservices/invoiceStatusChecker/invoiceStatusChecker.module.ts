import { Module } from '@nestjs/common';
import { InfluxModule } from '../../influx/influx.module.js';
import { InvoiceStatusChecker } from './invoiceStatusChecker.service.js';
import { BullModule } from '@nestjs/bull';
import { PrivateAPICustomerModule } from '../../customer/customer.module.js';
import { PrivateAPISettingsModule } from '../../setting/settings.module.js';
import { PrivateAPIInvoicesModule } from '../../invoice/invoices.module.js';
import { PaymentModule } from '../../payment/payment.module.js';

@Module({
    controllers: [],
    providers: [InvoiceStatusChecker],
    imports: [
        PrivateAPISettingsModule,
        PrivateAPIInvoicesModule,
        PaymentModule,
        PrivateAPICustomerModule,
        BullModule.registerQueue({
            name: 'scheduler_queue',
        }),
    ],
})
export class InvoiceStatusCheckerModule {}
