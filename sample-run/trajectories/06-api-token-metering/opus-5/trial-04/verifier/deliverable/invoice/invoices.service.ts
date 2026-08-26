import { BadRequestException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { CustomerService } from '../customer/customer.service.js';
import { SettingsService } from '../setting/settings.service.js';
import { UpdateInvoicesDto } from './dto/update-invoices.dto.js';
import { Invoice, InvoiceLineItem, InvoiceLineItems, PresignedURLType } from './entities/invoice.entity.js';
import { InfluxService } from '../influx/influx.service.js';
import { ReadInvoicesDto, ReadInvoicesResponse } from './dto/read-invoices.dto.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { PaymentService } from '../payment/payment.service.js';
import { CreateInvoiceResponseDto, CreateInvoicesDto, CustomerInvoiceDto } from './dto/create-Invoices.dto.js';
import { DimensionsService } from '../dimensions/dimensions.service.js';
import { GenerateOffCycleDto } from './dto/createOffcycleInvoice.js';
import { getFirstDayOfCurrentMonthUTC } from '../utils/shared/dateFormating.js';
import { UsageService } from '../usage/usage.service.js';
import { TaxService } from '../tax/tax.service.js';
import { Offering } from '../offering/entities/offeringPackage.entity.js';
import { ReadCustomerResponseData } from '../customer/entities/customer.entity.js';
import { CreditService } from '../credit/credit.service.js';
import { WebhookProcessorEventType, WebhookPublishingService } from '../webhook/webhook.service.js';
import { WebhookType } from '../webhook/dto/create-webhook.dto.js';
import { InvoiceInfluxRow } from '../influx/entities/InvoiceInfluxTable.entity.js';
import { AggregatedUsageResponse } from '../customer/dto/read-customer.dto.js';
import { ContractService } from '../contract/contract.service.js';
import { Billing } from '../billing/entities/billing.entity.js';
import { InvoiceStatusCheckerDto } from '../microservices/invoiceStatusChecker/dto/invoiceStatusChecker.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { InvoiceStatusChecker } from '../microservices/invoiceStatusChecker/invoiceStatusChecker.service.js';
import { schedulerType } from '../scheduler/dto/scheduler.dto.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { TokenType } from '../token-consumer/dto/TokenType.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;
@Injectable()
export class InvoicesService {
    private static readonly logger = new Logger(InvoicesService.name);

    constructor(
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => PaymentService)) readonly paymentService: PaymentService,
        @Inject(forwardRef(() => UsageService)) readonly usageService: UsageService,
        @Inject(forwardRef(() => DimensionsService)) readonly dimensionService: DimensionsService,
        @Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService,
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        @Inject(forwardRef(() => TaxService)) readonly taxService: TaxService,
        @Inject(forwardRef(() => CreditService)) readonly creditService: CreditService,
        @Inject(forwardRef(() => ContractService)) readonly contractService: ContractService,
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
    ) {}

    /**
     * @param businessID
     * @param customerId
     * @param items
     */
    async create(
        {
            businessID,
            customerId,
            items,
            invoiceDate = new Date().toISOString(),
            invoicePaymentTerm,
            currency,
            customer,
        }: CreateInvoicesDto & CustomerInvoiceDto,
        isManual = false,
    ): Promise<CreateInvoiceResponseDto> {
        InvoicesService.logger.log(`Creating invoice for business ${businessID}, currency: ${currency}`);
        const newInvoice = await this.buildInvoice({
            businessID,
            customerId,
            items,
            invoiceDate,
            invoicePaymentTerm,
            currency,
            customer,
        });
        const res = await newInvoice.generate(this.taxService, isManual);
        await this.tokenConsumerService.create({
            businessID: businessID,
            metadata: { tokenType: TokenType.invoice, invoiceId: newInvoice?.invoiceId, businessID: businessID },
            tokenAmount: '1',
            timestamp: new Date().toISOString(),
        });
        WebhookPublishingService.publishEvent({
            topic: WebhookProcessorEventType.Standard,
            type: WebhookType.INVOICE_CREATED,
            data: [{ ...res, customerId, offeringIds: customer?.offeringIds }],
            businessID,
        });
        return res;
    }
    async buildInvoice({
        businessID,
        customerId,
        items,
        invoiceDate = new Date().toISOString(),
        invoicePaymentTerm,
        currency,
        customer,
    }: CreateInvoicesDto & CustomerInvoiceDto): Promise<Invoice> {
        let invoiceLineItems: InvoiceLineItems;
        if (items instanceof InvoiceLineItems) {
            invoiceLineItems = items;
        } else {
            invoiceLineItems = new InvoiceLineItems();

            items.forEach((item) => {
                invoiceLineItems.addLineItem(new InvoiceLineItem(item.name, item.quantity, item.unitCost));
            });
        }
        const [settingsEntity] = await this.settingsService.findAll({ businessID });
        const { invoicePaymentTerm: defaultInvoicePaymentTerm } = settingsEntity;

        let customerEntity: ReadCustomerResponseData;
        if (customer) {
            customerEntity = customer;
        } else {
            const {
                data: [foundCustomer],
            } = await this.customerService.findOne({ businessID, customerId });
            customerEntity = foundCustomer;
        }

        const newInvoice = new Invoice({
            customerId,
            invoiceLineItems: invoiceLineItems,
            invoiceDate,
            invoicePaymentTerm: invoicePaymentTerm ? invoicePaymentTerm : defaultInvoicePaymentTerm,
            businessID,
            paymentAPI: this.paymentService,
            currency: currency
                ? currency
                : Offering.getCurrency({ customer: customerEntity, offering: customerEntity?.offering }),
            influxService: this.influxService,
        });
        newInvoice.loadPropertiesFromSettingsEntity(settingsEntity);
        newInvoice.loadPropertiesFromCustomerEntity(customerEntity);
        return newInvoice;
    }

    async findAll(businessID: string, customerId: string, onlyOpenAndPaid?: boolean): Promise<Invoice[]> {
        InvoicesService.logger.log(`Finding all invoices for business ${businessID}, customer ${customerId}`);
        const invoiceDbModels = await this.influxService.getInvoicesForCustomer({
            businessID,
            customerId,
            onlyOpenAndPaid,
        });
        const [settingsEntity] = await this.settingsService.findAll({ businessID });

        return Promise.all(
            invoiceDbModels.map(async (dbModel) => {
                const invoiceEntity = Invoice.fromDBModel(dbModel);
                invoiceEntity.loadPropertiesFromSettingsEntity(settingsEntity);
                if (invoiceEntity.invoiceStatus === 'Open' || invoiceEntity.invoiceStatus === 'Draft') {
                    if (invoiceEntity?.stripeAccountId) {
                        invoiceEntity.paymentLink = await invoiceEntity.generatePresignedUrl(
                            PresignedURLType.Payment,
                            this.localJWTAuthService,
                        );
                    }
                }
                return invoiceEntity;
            }),
        );
    }
    async findAllInvoicesForBusiness(businessID: string): Promise<Record<string, Invoice[]>> {
        const invoicesGroupedByCustomer = await this.influxService.getAllInvoicesGroupedByCustomer({ businessID });
        return invoicesGroupedByCustomer.reduce((acc, curr) => {
            const { customerId } = curr;
            if (acc[customerId]) {
                acc[customerId].push(Invoice.fromDBModel(curr));
            } else {
                acc[customerId] = [Invoice.fromDBModel(curr)];
            }
            return acc;
        }, {});
    }

    async findOne(businessID: string, invoiceId: string, download: string): Promise<ReadInvoicesResponse> {
        InvoicesService.logger.log(`Finding invoice ${invoiceId} for business ${businessID}`);
        const [invoiceDbModel] = await this.influxService.getSingleInvoice({ businessID, invoiceId });
        if (invoiceDbModel) {
            const invoice = Invoice.fromDBModel(invoiceDbModel);
            invoice.amountPaid = await invoice.getAmountPaid(this.paymentService);
            const customer = await this.customerService.findOne({ businessID, customerId: invoice.customerId });
            invoice.payments = await invoice.getPayments(customer, this.customerService, this.creditService);
            invoice.refunds = await invoice.getRefunds(customer, this.customerService);
            let invoiceUrl = null;
            const [settingsEntity] = await this.settingsService.findAll({ businessID });
            invoice.loadPropertiesFromSettingsEntity(settingsEntity);
            if (download === 'true') {
                await invoice.generatePDFforInvoice({
                    fromEntity: invoice?.fromEntity,
                    toEntity: invoice?.toEntity,
                    paidAmount: invoice.amountPaid,
                    jwtService: this.localJWTAuthService,
                });

                invoiceUrl = await invoice.generatePresignedUrl();
            }
            if (invoice?.invoiceStatus && (invoice?.invoiceStatus === 'Open' || invoice?.invoiceStatus === 'Draft')) {
                if (invoice?.stripeAccountId) {
                    InvoicesService.logger.log(`Generating payment link for invoice ${invoiceId}`);
                    invoice.paymentLink = await invoice.generatePresignedUrl(
                        PresignedURLType?.Payment,
                        this.localJWTAuthService,
                    );
                }
            }
            return { data: [new ReadInvoicesDto(invoice, invoiceUrl)], message: 'Found invoice' };
        } else {
            throw new NotFoundException(`Invoice ${invoiceId} not found`);
        }
    }

    async update({ businessID, invoiceId, ...otherFields }: UpdateInvoicesDto): Promise<BasicResponseDTO> {
        InvoicesService.logger.log(`Updating invoice ${invoiceId} for business ${businessID}`);
        const [invoiceDbModel] = await this.influxService.getSingleInvoice({ businessID, invoiceId });
        if (invoiceDbModel) {
            const invoice = Invoice.fromDBModel(invoiceDbModel);
            const { invoiceDate, invoiceStatus: currentStatus, ...rest } = invoice;

            const [settingsEntity] = await this.settingsService.findAll({ businessID });
            const customerData = await this.customerService.findOne({ businessID, customerId: rest.customerId });
            const customerEntity = customerData.data[0];
            const msg = await Invoice.update(
                { invoiceId, businessID, ...otherFields },
                invoice,
                customerEntity,
                settingsEntity,
                this.taxService,
            );
            try {
                return { message: msg };
            } catch (e) {
                throw new BadRequestException(e.message);
            }
        } else {
            throw new NotFoundException(`Invoice ${invoiceId} not found`);
        }
    }

    async generateInvoiceForUsageTotal(
        { businessID, customerId, start, end, invoicePaymentTerm, invoiceDate, offeringId }: GenerateOffCycleDto,
        isManual = false,
    ): Promise<{ invoiceId: string; invoiceIds: string[] }> {
        InvoicesService.logger.log(
            `Generating invoice for customer ${customerId} for business ${businessID}, start: ${start}, end: ${end}`,
        );
        // Get all services for the customer
        // usage for each service
        if (!start) {
            start = getFirstDayOfCurrentMonthUTC().toISOString();
        }

        if (!end) {
            end = new Date().toISOString();
        }
        InvoicesService.logger.log(
            `startTime: ${start}, endTime: ${end}, customerId: ${customerId}, businessID: ${businessID}, invoicePaymentTerm: ${invoicePaymentTerm}`,
        );
        const {
            data: [customerData],
        } = await this.customerService.findOne({ businessID, customerId });
        const { offeringIds } = customerData;

        const contracts = await this.contractService.findAllContractsForCustomer(
            offeringIds.map((id) => ({ businessID, customerId, offeringId: id })),
        );
        if (offeringId) {
            const contract = contracts.find((contract) => contract.offeringId === offeringId);
            if (!contract) {
                throw new NotFoundException(`Offering ${offeringId} not found for customer ${customerId}`);
            }
            const { offering: offeringInstance } = contract;
            const invoiceId = await offeringInstance.offcycleBilling({
                startDate: new Date(start),
                endDate: new Date(end),
                customer: customerData,
                invoiceDate,
                invoicePaymentTerm,
                isManual,
            });
            return { invoiceId, invoiceIds: [invoiceId] };
        } else {
            const invoiceIds = await Promise.all(
                contracts.map(async (contract) => {
                    const offeringInstance = contract.offering;
                    const invoiceId = await offeringInstance.offcycleBilling({
                        startDate: new Date(start),
                        endDate: new Date(end),
                        customer: customerData,
                        invoiceDate,
                        invoicePaymentTerm,
                        isManual,
                    });
                    return invoiceId;
                }),
            );
            return { invoiceId: invoiceIds[0], invoiceIds };
        }
    }

    async queueInvoice({
        businessID,
        customerId,
        items,
        invoiceDate = new Date().toISOString(),
        invoicePaymentTerm,
        currency,
        customer,
    }: CreateInvoicesDto & CustomerInvoiceDto) {
        const newInvoice = await this.buildInvoice({
            businessID,
            customerId,
            items,
            invoiceDate,
            invoicePaymentTerm,
            currency,
            customer,
        });
        await newInvoice.queue();
        return { message: 'Invoice queued' };
    }

    async consolidateInvoice({
        startTime,
        endTime,
        businessID,
        customerId,
        invoiceDate,
        initalLineItems,
    }: {
        startTime: string;
        endTime: string;
        businessID: string;
        customerId: string;
        invoiceDate: string;
        initalLineItems?: InvoiceLineItems;
    }) {
        Invoice.logger.debug(`Consolidating invoice for customer ${customerId} for business ${businessID}`);
        Invoice.logger.debug(`startTime: ${startTime}, endTime: ${endTime}, customerId: ${customerId}`);
        const queuedInvoices = await this.influxService.getQueuedInvoicesForCustomer({
            startTime,
            endTime,
            businessID,
            customerId,
        });
        const items = queuedInvoices.reduce((acc: InvoiceLineItems, curr: InvoiceInfluxRow): InvoiceLineItems => {
            const { invoiceLineItems } = curr;
            if (invoiceLineItems) {
                const parsed = JSON.parse(invoiceLineItems);
                parsed.forEach((item) => {
                    acc.addLineItem(new InvoiceLineItem(item.name, item.quantity, item.unitCost, item.description));
                });
            }
            return acc;
        }, new InvoiceLineItems());
        if (initalLineItems) {
            initalLineItems.getLineItems().forEach((item) => {
                items.addLineItem(new InvoiceLineItem(item.name, item.quantity, item.unitCost, item.description));
            });
        }
        Invoice.logger.debug(`items: ${JSON.stringify(items)}`);
        const invoiceResponse = await this.create({ items, businessID, customerId, invoiceDate });
        return invoiceResponse;
    }
    async generateInvoiceGivenUsage(customer: ReadCustomerResponseData, usage: AggregatedUsageResponse[]) {
        const { businessID, customerId, offeringIds } = customer;
        const contracts = await this.contractService.findAllContractsForCustomer(
            offeringIds.map((id) => ({ businessID, customerId, offeringId: id })),
        );
        const invoiceDate = new Date();
        const lineItemsArr = await Promise.all(
            contracts.map(async ({ offering: offeringInstance }) => {
                offeringInstance.usageOverrides = usage;

                const billingCycleEndDate = Billing.billingCycleToTimeRange(
                    offeringInstance.billingCycle,
                ).currentBillingCycleEndTime;
                return Offering.getLineItemsForUsage({
                    customer,
                    offeringInstance,
                    startDate: invoiceDate,
                    endDate: new Date(billingCycleEndDate),
                    businessID,
                    customerId,
                    proratedStartDate: invoiceDate,
                    dimensions: offeringInstance.dimensions,
                    customerService: this.customerService,
                    lineItems: new InvoiceLineItems(),
                });
            }),
        );
        const lineItems = lineItemsArr.reduce((acc, curr) => {
            curr.getLineItems().forEach((item) => {
                acc.addLineItem(item);
            });
            return acc;
        }, new InvoiceLineItems());
        const res = await this.create({
            businessID,
            customerId,
            currency: Offering.getCurrency({ customer }),
            customer,
            items: lineItems,
            invoiceDate: invoiceDate.toISOString(),
        });
        return res;
    }
    async queueInvoiceStatusChecker({
        invoiceId,
        businessID,
        customerId,
        timesChecked,
    }: InvoiceStatusCheckerDto): Promise<BasicResponseDTO> {
        InvoicesService.logger.log(`Queueing invoice status checker for invoice: ${invoiceId}`);
        await this.schedulerService.emitOne({
            schedulerId: InvoiceStatusChecker.getInvoiceStatusScheduleId(businessID, customerId, invoiceId),
            payload: {
                dimensionType: 'invoiceStatusChecker',
                businessID,
                scheduleParameters: { invoiceId, businessID, customerId, timesChecked } as InvoiceStatusCheckerDto,
                subject: customerId,
                delay: FIVE_MINUTES_IN_MS,
                schedulerType: schedulerType.dimensionDataGathering,
            },
        });
        return { message: 'Invoice status checker queued' };
    }
}
