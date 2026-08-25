import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { InvoiceLineGathererService } from './invoiceLineGatherer.service.js';

@Module({
    controllers: [],
    providers: [InvoiceLineGathererService],
    imports: [
        BullModule.registerQueue({
            name: 'scheduler_billing_queue',
        }),
    ],
})
export class InvoiceLineGathererModule {}
