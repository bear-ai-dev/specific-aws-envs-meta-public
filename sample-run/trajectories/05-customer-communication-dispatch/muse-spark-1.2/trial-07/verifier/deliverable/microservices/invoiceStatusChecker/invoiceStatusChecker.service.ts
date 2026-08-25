import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { InfluxService } from '../../influx/influx.service.js';
import { InvoiceStatusCheckerDto } from './dto/invoiceStatusChecker.dto.js';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { CustomerService } from '../../customer/customer.service.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { InvoiceStatus } from '../../invoice/entities/InvoiceStatus.js';
import { Invoice, InvoiceLineItem, InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { InvoicesService } from '../../invoice/invoices.service.js';
import { PaymentService } from '../../payment/payment.service.js';
import { paymentChannel } from '../../customer/dto/create-customer.dto.js';
import { SettingsService } from '../../setting/settings.service.js';

@Processor('scheduler_queue')
export class InvoiceStatusChecker {
    private static readonly logger = new Logger(InvoiceStatusChecker.name);
    constructor(
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => InvoicesService)) readonly invoicesService: InvoicesService,
        @Inject(forwardRef(() => PaymentService)) readonly paymentService: PaymentService,
        @Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService,
    ) {}

    @Process('invoiceStatusChecker')
    async evaluateEntitlements({ data: { scheduleParameters, subject } }: Job<SchedulerEntity>) {
        InvoiceStatusChecker.logger.log(`Starting invoice status checker for ${subject}`);
        const { businessID, invoiceId, customerId, timesChecked } = scheduleParameters as InvoiceStatusCheckerDto;
        const intTimesChecked = parseInt(timesChecked, 10);
        if (intTimesChecked > 3) {
            InvoiceStatusChecker.logger.error(
                `Invoice status checker has been checked more than 3 times for customer: ${customerId}. invoiceId: ${invoiceId}`,
            );
            return;
        }
        InvoiceStatusChecker.logger.log(`Evaluating invoice for customer: ${customerId}. invoiceId: ${invoiceId}`);
        const {
            data: [customer],
        } = await this.customerService.findOne({ customerId, businessID });
        const invoice = customer.invoices.find((i) => i.invoiceId === invoiceId);
        if (!invoice) {
            InvoiceStatusChecker.logger.error(`Invoice not found for customer: ${customerId}. invoiceId: ${invoiceId}`);
            return;
        }
        const invoiceEntity = new Invoice({
            ...invoice,
            invoiceLineItems: invoice.lineItems
                ? invoice.lineItems
                      .map(
                          ({ quantity, unitCost, description, name }) =>
                              new InvoiceLineItem(name, quantity, unitCost, description),
                      )
                      .reduce((acc, item) => {
                          acc.addLineItem(item);
                          return acc;
                      }, new InvoiceLineItems())
                : undefined,
            businessID,
            customerId,
        });
        const { amountPaid, invoiceStatus } = invoice;
        if (invoiceStatus === InvoiceStatus.PAID) {
            InvoiceStatusChecker.logger.log(
                `Invoice already processed for customer: ${customerId}. invoiceId: ${invoiceId}`,
            );
            return;
        }
        if (amountPaid === invoiceEntity.total) {
            InvoiceStatusChecker.logger.log(`Invoice fully paid for customer: ${customerId}. invoiceId: ${invoiceId}`);
            await this.invoicesService.update({ invoiceId, businessID, invoiceStatus: InvoiceStatus.PAID });
            return;
        }
        // if the customer is a stripe customer, and the invoice is not paid, we should check the payments inside of stripe
        if (customer.paymentChannel === paymentChannel.Stripe && customer?.paymentChannelOptions?.stripeCustomerId) {
            const [settingsEntity] = await this.settingsService.findAll({ businessID });
            const completedStripePayment = await this.paymentService.validateStripePaymentCompleteForInvoice({
                businessID,
                customerId,
                invoiceId,
                customer,
                settings: settingsEntity,
            });
            if (completedStripePayment) {
                InvoiceStatusChecker.logger.log(
                    `Stripe payment completed for customer: ${customerId}. invoiceId: ${invoiceId}`,
                );
                await this.invoicesService.update({ invoiceId, businessID, invoiceStatus: InvoiceStatus.PAID });
                return;
            } else {
                InvoiceStatusChecker.logger.log(
                    `Stripe payment not completed for customer: ${customerId}. invoiceId: ${invoiceId}`,
                );
            }
        }
        InvoiceStatusChecker.logger.log(`Invoice not fully paid for customer: ${customerId}. invoiceId: ${invoiceId}`);
        InvoiceStatusChecker.logger.log(
            `Queueing invoice status checker for customer: ${customerId}. invoiceId: ${invoiceId} timesChecked: ${timesChecked}`,
        );
        await this.invoicesService.queueInvoiceStatusChecker({
            businessID,
            customerId,
            invoiceId,
            timesChecked: (intTimesChecked + 1).toString(),
        });
    }
    @OnQueueFailed({ name: 'invoiceStatusChecker' })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to determine invoice status',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
    static getInvoiceStatusScheduleId(businessID: string, customerId: string, invoiceId: string) {
        return `invoiceStatusChecker-${businessID}-${customerId}-${invoiceId}`;
    }
}
