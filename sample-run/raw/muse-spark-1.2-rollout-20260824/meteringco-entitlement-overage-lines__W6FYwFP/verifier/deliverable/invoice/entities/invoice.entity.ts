import { BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { TaxCalculationType } from '../../setting/dto/TaxCalculationType.js';
import { TaxableLineItem, TaxableLineItems, TaxService } from '../../tax/tax.service.js';
import fetch from 'cross-fetch';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Point } from '@influxdata/influxdb-client';
import { InfluxService } from '../../influx/influx.service.js';
import { InvoiceInfluxRow } from '../../influx/entities/InvoiceInfluxTable.entity.js';
import { CustomerEntity, ReadCustomerResponseData } from '../../customer/entities/customer.entity.js';
import { PaymentService } from '../../payment/payment.service.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';
import { ReadSettingsResponseData } from '../../setting/dto/read-setting.dto.js';
import { default as CountryLookup } from '../../setting/countryLookup.json';
import { default as EUCountryCodes } from '../../setting/euCountries.json';
import { putDocument } from '../../utils/aws/s3.js';
import { UpdateInvoicesDto } from '../dto/update-invoices.dto.js';
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { toDateString } from '../../utils/shared/dateFormating.js';
import { TaxExempt } from '../../customer/dto/TaxExempt.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { InvoicePaymentTerm } from './InvoicePaymentTerm.js';
import { serializeError } from 'serialize-error';
import { paymentChannel } from '../../customer/dto/create-customer.dto.js';
import { AccountState } from '../../setting/entities/AccountState.js';
import { suffixIfNotEmpty } from '../../utils/shared/utils.js';
import getSymbolFromCurrency from 'currency-symbol-map';
import { StripeRefundResponseDto } from '../../payment/dto/stripeRefundResponse.dto.js';
import { CustomerReadResponse, CustomerService } from '../../customer/customer.service.js';
import { CreditService } from '../../credit/credit.service.js';
import { ReadPaymentDto } from '../../payment/dto/readPayment.dto.js';
import { InvoiceApproval } from '../../setting/dto/InvoiceApproval.js';
import { InvoiceStatus } from './InvoiceStatus.js';
import { ApiProperty } from '@nestjs/swagger';
import { LocalJWTAuthService } from '../../authz/jwt-local.strategy.js';
import { WebhookProcessorEventType, WebhookPublishingService } from '../../webhook/webhook.service.js';
import { WebhookType } from '../../webhook/dto/create-webhook.dto.js';
import { ReadInvoicesDto } from '../../invoice/dto/read-invoices.dto.js';

export type InvoiceRefunds = StripeRefundResponseDto;

export enum PresignedURLType {
    S3 = 'S3',
    Payment = 'Payment',
}

export class InvoiceLineItem {
    /**
     * The name of the line item as it appears on the invoice.
     * <br><br>
     * Example: `"MeteringCo Pro"`
     * @example "MeteringCo Pro"
     */
    @IsString()
    @IsNotEmpty()
    @ApiProperty()
    name: string;

    /**
     * The quantity of the line item.
     * <br><br>
     * Example: `1`
     * @example 1
     */
    @IsNumber()
    @Min(0)
    @IsNotEmpty()
    @ApiProperty()
    quantity: number;

    /**
     * The unit cost of the line item.
     * <br><br>
     * Example: `100.00`
     * @example 100.00
     */
    @IsNumber()
    @IsNotEmpty()
    @ApiProperty()
    unitCost: number;

    /**
     * The description of the line item.
     * <br><br>
     * Example: `"MeteringCo Pro subscription"`
     * @example "MeteringCo Pro subscription"
     */
    @IsString()
    @IsOptional()
    @ApiProperty()
    description?: string;

    constructor(name: string, quantity: number, unitCost: number, description?: string) {
        this.name = name;
        this.quantity = quantity;
        this.unitCost = unitCost;
        this.description = description;
    }
    static snakeCaseTransformUnitCost({ unitCost, ...rest }: InvoiceLineItem) {
        return { unit_cost: unitCost, ...rest };
    }
    static prepareLineItem({
        total,
        dimensionType,
        dimensionUnit,
        dimensionName,
        dimensionId,
        offeringName,
        usageIncrement,
        negative,
        tieredName,
    }: {
        total: number;
        dimensionType: string;
        dimensionName: string;
        dimensionUnit: string;
        dimensionId: string;
        offeringName: string;
        usageIncrement: number;
        negative?: boolean;
        tieredName?: string;
    }): { total: number; dimension: string; unit?: string; displayName: string } {
        const timeBasedUnits = {
            second: {
                60: 'minute',
                3600: 'hour',
                86400: 'day',
            },
            minute: { 60: 'hour', 1440: 'day' },
            hour: { 24: 'day' },
        };
        const dataBasedUnits = {
            byte: {
                1024: 'kibibyte',
                1000: 'kilobyte',
                1048576: 'mebibyte',
                1000000: 'megabyte',
                1073741824: 'gibibyte',
                1000000000: 'gigabyte',
            },
            kilobyte: {
                1000: 'megabyte',
                1000000: 'gigabyte',
            },
            megabyte: {
                1000: 'gigabyte',
            },
            kibibyte: {
                1024: 'mebibyte',
                1048576: 'gibibyte',
            },
            mebibyte: {
                1024: 'gibibyte',
            },
        };

        const rawTotal = total;
        let newDisplayUnit = dimensionUnit;
        let displayName = dimensionName;
        switch (dimensionType) {
            case 'count':
                if (rawTotal >= 1000000000 && usageIncrement / 1000000000 === 1) {
                    newDisplayUnit = 'Billion ' + dimensionName;
                } else if (rawTotal >= 1000000 && usageIncrement / 1000000 === 1) {
                    newDisplayUnit = 'Million ' + dimensionName;
                } else if (rawTotal >= 1000 && usageIncrement / 1000 === 1) {
                    newDisplayUnit = 'Thousand';
                } else {
                    newDisplayUnit = undefined;
                }
                break;
            case 'time':
                if (usageIncrement === 1) {
                    break;
                }
                if (!timeBasedUnits[dimensionUnit]) {
                    newDisplayUnit = undefined;
                    break;
                }
                if (!timeBasedUnits[dimensionUnit][usageIncrement]) {
                    newDisplayUnit = undefined;
                    break;
                }
                newDisplayUnit = timeBasedUnits[dimensionUnit][usageIncrement];
                break;
            case 'data':
                if (usageIncrement === 1) {
                    break;
                }

                if (!dataBasedUnits[dimensionUnit]) {
                    newDisplayUnit = undefined;
                    break;
                }
                if (!dataBasedUnits[dimensionUnit][usageIncrement]) {
                    newDisplayUnit = undefined;
                    break;
                }
                newDisplayUnit = dataBasedUnits[dimensionUnit][usageIncrement];
                break;
        }

        displayName = newDisplayUnit
            ? `${dimensionName} - ${newDisplayUnit[0].toUpperCase()}${newDisplayUnit.slice(1)} - ${offeringName}`
            : `${dimensionName} - ${offeringName}`;
        displayName = tieredName ? `${displayName} - ${tieredName}` : displayName;
        return {
            total: negative ? (rawTotal / usageIncrement) * -1 : rawTotal / usageIncrement,
            dimension: dimensionId,
            displayName: negative ? `${displayName} - Free Trial Credit` : displayName,
            unit: newDisplayUnit ? newDisplayUnit.replace(/\w/, (c) => c.toUpperCase()) : undefined,
        };
    }
}

export class InvoiceLineItems {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => InvoiceLineItem)
    private lineItems: InvoiceLineItem[] = [];
    private terms?: string;

    addLineItem(lineItem: InvoiceLineItem) {
        this.lineItems.push(lineItem);
    }
    addTerms(terms: string) {
        this.terms = terms;
    }
    getTerms() {
        return this.terms;
    }

    getLineItems() {
        return this.lineItems;
    }
    getTotal() {
        return this.lineItems.reduce((acc, curr) => acc + curr.unitCost * curr.quantity, 0);
    }
    getSnakeCaseLineItems() {
        return this.lineItems.map(InvoiceLineItem.snakeCaseTransformUnitCost);
    }
}

export const signedURLGenerator = async (Bucket, Key) => {
    const client = new S3Client({
        region: 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
        },
    });
    const command = new GetObjectCommand({ Bucket, Key });
    const url = await getSignedUrl(client, command, { expiresIn: 604800 });
    return url;
};

export const checkIfInvoiceIsInBucket = async (Bucket, Key): Promise<boolean> => {
    const s3Client = new S3Client({ region: 'us-east-1' });
    const params = { Bucket, Key };

    try {
        const headObjectCommand = new HeadObjectCommand(params);
        await s3Client.send(headObjectCommand);
        return true;
    } catch (err) {
        if (err.name === 'NotFound') {
            return false;
        } else {
            throw err;
        }
    }
};

class InvalidInvoiceStatusException extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class Invoice {
    public static readonly logger = new Logger(Invoice.name);
    public static readonly _measurement = 'Invoice';
    public static readonly _queueMeasurement = 'InvoiceQueue';
    // Static constants
    private static readonly DEFAULT_REPLYTO_NAME = 'MeteringCo Billing';
    private static readonly DEFAULT_REPLYTO_ADDRESS = 'invoice-delivery-no-reply@meteringco.example';
    private static readonly DEFAULT_FROM_ADDRESS = 'team@meteringco.example';
    // Below properties are not stored in DB model
    public fromStreetLine1: string;
    public fromStreetLine2: string;
    public fromCity: string;
    public fromState: string;
    public fromPostalCode: string;
    public fromCountry: string;
    public toStreetLine1: string;
    public toStreetLine2: string;
    public toCity: string;
    public toState: string;
    public toPostalCode: string;
    public toCountry: string;
    public customerName: string;
    public customerEmail: string;
    public defaultTaxRate: string;
    public taxCalculationType: TaxCalculationType;
    public taxCategory: string;
    public taxExempt: TaxExempt;
    public businessName: string;
    public stripeAccountId: string;
    public accountState: AccountState;
    public amountPaid: number;
    public payments: ReadPaymentDto[];
    public refunds: InvoiceRefunds[];
    public invoiceApproval: InvoiceApproval;
    public supportEmail: string;

    public vatId: string;
    public logoUrl: string;
    public invoicePaymentTerm: InvoicePaymentTerm;
    public invoiceLineItems: InvoiceLineItems;
    public influxService: InfluxService = new InfluxService();
    public paymentAPI: PaymentService;
    public paymentChannel: paymentChannel;
    public paymentChannelOptions: CustomerEntity['paymentChannelOptions'];
    public customerVatId: string;
    public paymentLink?: string;
    // Below properties are stored in DB model
    public customerId: string;
    public businessID: string;
    public invoiceId: string;
    public invoiceStatus: InvoiceStatus;
    public invoiceS3bucket: string;
    public invoiceS3key: string;
    public invoiceDate: Date;
    public totalAmountWithoutTax: number;
    public taxAmount: number;
    public currency: SupportedCurrencies;
    public fromEntity: string;
    public toEntity: string;
    public salesTaxRate: number;
    public isManual: boolean;

    constructor({
        customerId = '',
        invoiceLineItems = null,
        businessID = '',
        invoiceId = randomUUID(),
        invoiceStatus = InvoiceStatus.DRAFT,
        invoiceS3bucket = '',
        invoiceS3key = '',
        invoiceDate = new Date().toISOString(),
        invoicePaymentTerm = InvoicePaymentTerm.none,
        totalAmountWithoutTax = 0,
        taxAmount = 0,
        paymentAPI,
        currency,
        fromEntity,
        toEntity,
        salesTaxRate,
        payments,
        refunds,
        influxService,
        isManual,
    }: {
        customerId?: string;
        invoiceLineItems?: InvoiceLineItems;
        businessID: string;
        invoiceId?: string;
        invoiceStatus?: InvoiceStatus;
        invoiceS3bucket?: string;
        invoiceS3key?: string;
        invoiceDate?: string;
        invoicePaymentTerm?: InvoicePaymentTerm;
        totalAmountWithoutTax?: number;
        taxAmount?: number;
        paymentAPI?: PaymentService;
        currency?: SupportedCurrencies;
        fromEntity?: string;
        toEntity?: string;
        salesTaxRate?: number;
        payments?: ReadPaymentDto[];
        refunds?: InvoiceRefunds[];
        influxService?: InfluxService;
        isManual?: string;
    }) {
        this.customerId = customerId;
        this.invoiceLineItems = invoiceLineItems;
        this.businessID = businessID;
        this.invoiceId = invoiceId;
        this.invoiceStatus = invoiceStatus;
        this.invoiceS3bucket = invoiceS3bucket;
        this.invoiceS3key = invoiceS3key;
        this.invoiceDate = new Date(invoiceDate);
        this.invoicePaymentTerm = invoicePaymentTerm;
        this.paymentAPI = paymentAPI;
        this.salesTaxRate = salesTaxRate;
        if (totalAmountWithoutTax === 0 && invoiceLineItems && invoiceLineItems.getLineItems().length > 0) {
            this.totalAmountWithoutTax = this.calculateTotalAmountWithoutTax();
        } else {
            this.totalAmountWithoutTax = totalAmountWithoutTax;
        }
        this.taxAmount = taxAmount;
        this.currency = currency ? currency : SupportedCurrencies.USD;
        this.fromEntity = fromEntity;
        this.toEntity = toEntity;
        this.payments = payments;
        this.refunds = refunds;
        if (influxService) {
            this.influxService = influxService;
        }
        if (isManual === 'true') {
            this.isManual = true;
        }
    }

    private calculateTotalAmountWithoutTax(): number {
        let totalAmount = 0;
        this.invoiceLineItems.getLineItems().forEach((lineItem) => {
            totalAmount += lineItem.quantity * lineItem.unitCost;
        });
        const total = parseFloat(totalAmount.toFixed(2));
        if (total < 0) {
            return 0.0;
        } else {
            return total;
        }
    }

    public get total(): number {
        return this.totalAmountWithoutTax + this.taxAmount;
    }

    public async getPayments(
        customer: CustomerReadResponse,
        customerService: CustomerService,
        creditService: CreditService,
    ): Promise<ReadPaymentDto[]> {
        Invoice.logger.debug(`Getting payments for invoice ${this.invoiceId}`);
        const data = customer.data[0].invoices.find(({ invoiceId }) => invoiceId === this.invoiceId)?.payments;
        return data;
    }

    public async getRefunds(
        customer,
        customerService: CustomerService,
        refunds?: StripeRefundResponseDto[],
    ): Promise<InvoiceRefunds[]> {
        Invoice.logger.debug(`Getting refunds for invoice ${this.invoiceId}`);
        const data = customer.data[0].invoices.find(({ invoiceId }) => invoiceId === this.invoiceId)?.refunds;
        return data;
    }
    public validateStatusUpdate(newInvoiceStatus: InvoiceStatus): boolean {
        Invoice.logger.log(`Validate status update`);
        if (this.invoiceStatus === InvoiceStatus.DRAFT) {
            if (
                newInvoiceStatus === InvoiceStatus.OPEN ||
                newInvoiceStatus === InvoiceStatus.VOIDED ||
                newInvoiceStatus === InvoiceStatus.DRAFT
            ) {
                return true;
            } else {
                return false;
            }
        } else if (this.invoiceStatus === InvoiceStatus.OPEN) {
            if (
                newInvoiceStatus === InvoiceStatus.PAID ||
                newInvoiceStatus === InvoiceStatus.VOIDED ||
                newInvoiceStatus === InvoiceStatus.OPEN
            ) {
                return true;
            } else {
                return false;
            }
        } else if (this.invoiceStatus === InvoiceStatus.PAID) {
            if (newInvoiceStatus === InvoiceStatus.VOIDED || newInvoiceStatus === InvoiceStatus.PAID) {
                return true;
            } else {
                return false;
            }
        } else if (this.invoiceStatus === InvoiceStatus.VOIDED) {
            return true;
        }
        return false;
    }
    private isEuropeanCountry(countryCode: string): boolean {
        if (countryCode) {
            return EUCountryCodes.includes(countryCode.toUpperCase());
        } else {
            return false;
        }
    }

    public async registerInvoiceTaxTransaction({
        taxService,
        taxTransactionId,
    }: {
        taxService: TaxService;
        taxTransactionId: string;
    }): Promise<any | null> {
        const transactionId = this.invoiceId || taxTransactionId;
        if (this.toState && this.toCountry && this.toPostalCode) {
            const taxInfo = await taxService.registerTransaction({
                businessID: this.businessID,
                transactionId,
                amount: this.totalAmountWithoutTax,
                lineItems: this.invoiceLineItems
                    ? this.invoiceLineItems
                          .getLineItems()
                          .map((lineItem) => TaxableLineItem.fromInvoiceLineItem(undefined, lineItem))
                    : [],
                salesTax: this.taxAmount,
                address: {
                    streetLineOne: this.toStreetLine1,
                    streetLineTwo: this.toStreetLine2,
                    city: this.toCity,
                    state: this.toState,
                    postalCode: this.toPostalCode,
                    countryCode: this.toCountry,
                },
            });
            return taxInfo;
        }
        return null;
    }

    public prepareAddressesForInvoice() {
        // prepare invoid
        const businessAddress =
            this.fromStreetLine1 +
            (this.fromStreetLine1 !== '' ? '\n' : '') +
            (this.fromStreetLine2 + (this.fromStreetLine2 !== '' ? '\n' : '')) +
            (this.fromCity + (this.fromCity !== '' ? ', ' : '')) +
            (this.fromState + (this.fromState !== '' ? ' ' : '')) +
            (this.fromPostalCode + (this.fromPostalCode !== '' ? '\n' : '')) +
            (this.fromCountry !== '' ? CountryLookup[this.fromCountry] : '') +
            (this.fromCountry !== '' ? '\n' : '') +
            (this.isEuropeanCountry(this.fromCountry) && this.vatId ? `VAT Registration Number: ${this.vatId}` : '');
        const customerAddress =
            this.toStreetLine1 +
            (this.toStreetLine1 !== '' ? '\n' : '') +
            (this.toStreetLine2 + (this.toStreetLine2 !== '' ? '\n' : '')) +
            (this.toCity + (this.toCity !== '' ? ', ' : '')) +
            (this.toState + (this.toState !== '' ? ' ' : '')) +
            (this.toPostalCode + (this.toPostalCode !== '' ? '\n' : '')) +
            (this.toCountry !== '' ? CountryLookup[this.toCountry] : '') +
            (this.toCountry !== '' ? '\n' : '') +
            (this.isEuropeanCountry(this.toCountry) && this.customerVatId
                ? `VAT Registration Number: ${this.customerVatId}`
                : '');
        const fromEntity = [this.businessName, businessAddress].map(suffixIfNotEmpty('\n')).join('');
        const toEntity = [this.customerName, this.customerEmail, customerAddress].map(suffixIfNotEmpty('\n')).join('');
        return {
            fromEntity,
            toEntity,
        };
    }
    public async generate(
        taxService: TaxService,
        isManual?: boolean,
    ): Promise<{ invoiceId: string; message: string; error?: any }> {
        if (!this.invoiceDate) {
            this.invoiceDate = new Date();
        }

        const { rate: salesTaxRate, error } = await this.getSalesTaxRate(taxService);
        this.salesTaxRate = salesTaxRate;
        this.taxAmount = salesTaxRate * this.totalAmountWithoutTax;
        // pdf storage
        this.invoiceS3bucket = `meteringco-${process.env.STAGE}-invoice-bucket`;
        this.invoiceS3key = `${this.businessID}-invoice-${new Date().toISOString()}.pdf`;
        const { fromEntity, toEntity } = this.prepareAddressesForInvoice();
        this.fromEntity = fromEntity;
        this.toEntity = toEntity;
        this.isManual = isManual;

        // meta data storage
        await this.saveToDB();
        if (
            this.invoiceApproval &&
            this.invoiceApproval === InvoiceApproval.automatic &&
            this.invoiceStatus &&
            this.invoiceStatus === InvoiceStatus.DRAFT &&
            !isManual
        ) {
            await this.updateStatus(InvoiceStatus.OPEN, taxService);
        }
        return {
            invoiceId: this.invoiceId,
            message: error
                ? 'WARNING Errors occured while generating invoice, invoice still generated'
                : 'Generated invoice',
            error,
        };
    }
    public async queue() {
        const queueModel = this.toQueueModel();
        await this.influxService.loadPoints(`${process.env.STAGE}-invoice-queue`, process.env.INFLUX_ORG, queueModel);
    }

    public getAmountPaid(paymentService: PaymentService) {
        return paymentService.getAmountPaid({
            businessID: this.businessID,
            invoiceId: this.invoiceId,
        });
    }

    public async generatePDFforInvoice({
        fromEntity,
        toEntity,
        paidAmount,
        regenerateInvoicePdf,
        jwtService,
    }: {
        fromEntity?: string;
        toEntity?: string;
        paidAmount?: number;
        regenerateInvoicePdf?: boolean;
        jwtService?: LocalJWTAuthService;
    }): Promise<{ invoiceId: string; message: string; error?: any }> {
        try {
            const isAlreadyInBucket = await checkIfInvoiceIsInBucket(this.invoiceS3bucket, this.invoiceS3key);
            if (isAlreadyInBucket && !regenerateInvoicePdf) {
                return;
            }
        } catch (err) {
            Invoice.logger.error(`Error checking if invoice is already in bucket: ${err}`);
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Error checking if invoice is already in bucket`,
                data: [serializeError(err)],
            });
        }
        let dueDate = null;
        if (
            this.invoicePaymentTerm &&
            (this.invoicePaymentTerm == InvoicePaymentTerm.net30 || this.invoicePaymentTerm == InvoicePaymentTerm.net60)
        ) {
            dueDate = new Date(this.invoiceDate.getTime() + Number(this.invoicePaymentTerm) * 86400000);
        }
        const paymentLink =
            jwtService && this.total > paidAmount
                ? await this.generatePresignedUrl(PresignedURLType.Payment, jwtService)
                : null;
        const invoicePdf = await Invoice.invoiceAPI({
            from: fromEntity ? fromEntity.replace(/\\n/g, '\n') : '',
            to: toEntity ? toEntity.replace(/\\n/g, '\n') : '',
            paidAmount,
            items: this.invoiceLineItems.getSnakeCaseLineItems(),
            invoiceNumber: this.invoiceId,
            dueDate: dueDate ? toDateString(dueDate) : toDateString(this.invoiceDate),
            invoiceDate: toDateString(this.invoiceDate),
            logoUrl: this.logoUrl,
            tax: this.salesTaxRate * 100,
            currency: this.currency,
            terms: this.invoiceLineItems?.getTerms(),
            invoiceTotal: this.total,
            totalWithoutTax: this.totalAmountWithoutTax,
            paymentLink: paymentLink,
        });
        Invoice.logger.debug(`Invoice PDF generated; ${invoicePdf}`);
        await putDocument(invoicePdf, this.invoiceS3bucket, this.invoiceS3key).done();
        return;
    }
    public async saveToDB(): Promise<void> {
        const dbModel = this.toDBModel();
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
    }

    public async updateStatus(newInvoiceStatus: InvoiceStatus, taxService: TaxService): Promise<string> {
        if (this.invoiceStatus == newInvoiceStatus) {
            return 'Invoice already has status ' + newInvoiceStatus;
        } else if (this.validateStatusUpdate(newInvoiceStatus)) {
            if (this.invoiceStatus == InvoiceStatus.DRAFT && newInvoiceStatus == InvoiceStatus.OPEN) {
                this.invoiceStatus = newInvoiceStatus;
                Invoice.logger.debug(`Invoice status updated to ${newInvoiceStatus}`);
                await this.saveToDB();
                try {
                    PaymentService.publishEvent({
                        topic: this.paymentChannel ? this.paymentChannel : paymentChannel.manual,
                        data: [
                            {
                                invoice: this,
                                stripeAccountId: this.stripeAccountId,
                                stripeCustomerId: this.paymentChannelOptions?.stripeCustomerId,
                                businessID: this.businessID,
                                accountState: this.accountState,
                                customerId: this.customerId,
                            },
                        ],
                    });
                } catch (error) {
                    AuditService.publishEvent({
                        message: 'Error Occured while processing invoice',
                        topic: AuditScope.ERROR,
                        data: [error],
                    });
                }
                try {
                    WebhookPublishingService.publishEvent({
                        topic: WebhookProcessorEventType.Standard,
                        type: WebhookType.INVOICE_SENT,
                        data: [new ReadInvoicesDto(this)],
                        businessID: this.businessID,
                    });
                } catch (error) {
                    AuditService.publishEvent({
                        message: 'Error Occured while processing webhook for invoice',
                        topic: AuditScope.ERROR,
                        data: [error],
                    });
                }
            } else if (newInvoiceStatus == InvoiceStatus.PAID) {
                await this.registerInvoiceTaxTransaction({ taxService, taxTransactionId: this.invoiceId });
                this.invoiceStatus = newInvoiceStatus;
                if (this.paymentChannel === paymentChannel.manual) {
                    PaymentService.publishEvent({
                        topic: this.paymentChannel,
                        data: [
                            {
                                invoice: this,
                                stripeAccountId: this.stripeAccountId,
                                stripeCustomerId: this.paymentChannelOptions?.stripeCustomerId,
                                businessID: this.businessID,
                                accountState: this.accountState,
                                customerId: this.customerId,
                            },
                        ],
                    });
                }

                await this.saveToDB();
            } else {
                this.invoiceStatus = newInvoiceStatus;
                Invoice.logger.debug(`Invoice status updated to ${newInvoiceStatus}`);
                await this.saveToDB();
            }

            return 'Invoice status updated to ' + newInvoiceStatus;
        } else {
            throw new InvalidInvoiceStatusException(
                `Invalid invoice status update from ${this.invoiceStatus} to ${newInvoiceStatus}`,
            );
        }
    }

    public async generatePresignedUrl(
        presignedURLType?: PresignedURLType,
        localJWTAuthService?: LocalJWTAuthService,
    ): Promise<string> {
        if (presignedURLType === PresignedURLType.Payment) {
            const { access_token } = await localJWTAuthService.generateCustomerTokenWithInvoiceId(
                this.customerId,
                this.businessID,
                this.invoiceId,
            );
            return `${process.env.METERINGCO_URL}/portal/customer/payment?state=${access_token}`;
        } else if (presignedURLType === PresignedURLType.S3) {
            return await signedURLGenerator(this.invoiceS3bucket, this.invoiceS3key);
        } else {
            return await signedURLGenerator(this.invoiceS3bucket, this.invoiceS3key);
        }
    }

    private async emailContentGenerator(jwtService?: LocalJWTAuthService): Promise<string> {
        switch (this.invoiceStatus) {
            case InvoiceStatus.OPEN:
                return (
                    'A new invoice from ' +
                    this.businessName +
                    ' is ready for review. Please review and make the payment for the invoice. <br/><br/>' +
                    'Download the invoice from this link:<br/>' +
                    `<a href=${await this.generatePresignedUrl()}>Invoice Download</a>` +
                    '<br/>' +
                    'Note that this link expires after 7 days. Please download the invoice before the link expires.<br/><br/>' +
                    'Please make payment at the following link:' +
                    `<a href=${await this.generatePresignedUrl(
                        PresignedURLType.Payment,
                        jwtService,
                    )}>Click Here to Process Payment</a> <br/><br/>` +
                    'Thanks for your business.'
                );
            case InvoiceStatus.PAID:
                return (
                    '<html>Hi, <br/><br/>' +
                    'A new invoice from ' +
                    this.businessName +
                    ' is ready for review. Payment has already been completed. <br/><br/>' +
                    'Download the invoice from this link:<br/>' +
                    `<a href=${await this.generatePresignedUrl()}>Invoice Download</a>` +
                    '<br/>' +
                    'Note that this link expires after 7 days. Please download the invoice before the link expires.<br/><br/>' +
                    'Thanks for your business.' +
                    '</html>'
                );
            default:
                return 'A new invoice is ready for review. Please review and make the payment for the invoice.';
        }
    }

    public async draftEmail(paidAmount?: number, jwtService?: LocalJWTAuthService) {
        const subject = `New invoice from ${this.businessName} #${this.invoiceId}`;
        await this.generatePDFforInvoice({
            fromEntity: this.fromEntity,
            toEntity: this.toEntity,
            paidAmount,
            regenerateInvoicePdf: true,
            jwtService: jwtService,
        });

        return {
            subject: subject,
            fromName: this.businessName,
            fromEmail: Invoice.DEFAULT_FROM_ADDRESS,
            toEmail: this.customerEmail,
            content: await this.emailContentGenerator(jwtService),
            replyToName: this.businessName ? this.businessName : Invoice.DEFAULT_REPLYTO_NAME,
            replyToEmail: this.supportEmail ? this.supportEmail : Invoice.DEFAULT_REPLYTO_ADDRESS,
        };
    }

    private async getSalesTaxRate(taxService: TaxService): Promise<{ rate: number; error?: { message: string } }> {
        Invoice.logger.log('Calculating sales tax');

        if (this.taxExempt === TaxExempt.exempt) {
            return { rate: 0 };
        }
        if (this.taxCalculationType === TaxCalculationType.manual) {
            Invoice.logger.log('Using manual tax rate');
            return { rate: Number(this.defaultTaxRate) };
        } else if (this.taxCalculationType === TaxCalculationType.meteringcoCalculated) {
            Invoice.logger.log('Using meteringco calculated tax rate');
            const taxableLineItems = new TaxableLineItems();
            this.invoiceLineItems.getLineItems().forEach((lineItem) => {
                taxableLineItems.addLineItem(TaxableLineItem.fromInvoiceLineItem(this.taxCategory, lineItem));
            });
            const { rate, error } = await taxService.calculateSalesTax(
                this.fromCountry,
                this.fromPostalCode,
                this.fromState,
                this.fromCity,
                this.fromStreetLine1,
                this.toCountry,
                this.toPostalCode,
                this.toState,
                this.toCity,
                this.toStreetLine1,
                taxableLineItems,
                this.businessID,
            );
            return { rate, error };
        } else if (this.taxCalculationType === TaxCalculationType.none) {
            Invoice.logger.log('No tax calculation');
            return { rate: 0 };
        }
        return { rate: 0 };
    }
    static digitsEnforcer(value: number): number {
        if (value.toString().split('.')[1]) {
            if (value.toString().split('.')[1].length > 8) {
                return 8;
            } else {
                return value.toString().split('.')[1].length;
            }
        } else {
            return 2;
        }
    }

    private static async invoiceAPI({
        from,
        to,
        paidAmount,
        items,
        invoiceNumber = null, // if null, will be generated
        invoiceDate = null, // if null, will be generated
        dueDate = null, // if null, will be skipped
        logoUrl = null, // if null, will be skipped
        tax = null, // if null, will be skipped
        currency,
        terms,
        invoiceTotal,
        totalWithoutTax,
        paymentLink = null,
    }: {
        from: string;
        to: string;
        paidAmount: number;
        items: Array<{ quantity: number; unit_cost: number; name: string; description?: string }>;
        invoiceNumber?: string;
        invoiceDate?: string;
        dueDate?: string;
        logoUrl?: string;
        tax?: number;
        currency: string;
        terms?: string;
        invoiceTotal: number;
        totalWithoutTax: number;
        paymentLink?: string;
    }): Promise<ReadableStream<Uint8Array>> {
        Invoice.logger.log(`Generating invoice`);
        let logo: Buffer | Response;
        if (logoUrl) {
            try {
                logo = await fetch(logoUrl);
                logo = Buffer.from(await logo.arrayBuffer());
            } catch (e) {
                Invoice.logger.log(`Failed to fetch logo ${logoUrl}`);
                Invoice.logger.error(e);
            }
        }
        const payload = {
            from,
            to,
            number: invoiceNumber ? invoiceNumber : randomUUID(),
            logo,
            date: invoiceDate ? invoiceDate : new Date().toISOString(),
            due_date: dueDate,
            items: items,
            tax: tax,
            notes_title: 'Terms',
            notes: terms ? terms : undefined,
            currency: getSymbolFromCurrency(currency) || currency,
            total: invoiceTotal,
            balanceDue: invoiceTotal - paidAmount,
            totalWithoutTax,
        };
        //  eslint-disable-next-line @typescript-eslint/no-var-requires
        const MicroInvoice = require('@twosdai/microinvoice');
        const parts = items.map(({ name, quantity, unit_cost }) => [
            { value: name },
            { value: quantity },
            {
                value: unit_cost.toString(),
                price: true,
                digits: Invoice.digitsEnforcer(unit_cost),
            },
            { value: (quantity * unit_cost).toFixed(2), price: true },
        ]);
        const invoice = new MicroInvoice({
            style: {
                header: {
                    backgroundColor: '#FFFFFF',
                    height: 200,
                    image: logo
                        ? {
                              path: logo,
                              width: 100,
                          }
                        : undefined,
                },
            },
            data: {
                invoice: {
                    name: 'Invoice',
                    header: [
                        {
                            label: 'Invoice Number',
                            value: payload.number,
                        },
                        {
                            label: 'Invoice Date',
                            value: payload.date,
                        },
                        {
                            label: 'Due Date',
                            value: payload.due_date,
                        },
                        {
                            label: 'Balance Due',
                            value: payload.balanceDue.toFixed(2),
                            price: true,
                        },
                    ],
                    currency: payload.currency,
                    customer: [
                        {
                            label: 'Bill To',
                            value: [to],
                        },
                    ],
                    seller: [
                        {
                            label: 'Bill From',
                            value: [from],
                        },
                    ],
                    details: {
                        header: [
                            {
                                value: 'Item',
                            },
                            {
                                value: 'Quantity',
                            },
                            {
                                value: 'Rate',
                            },
                            {
                                value: 'Amount',
                            },
                        ],
                        parts,
                        total: [
                            { label: 'Subtotal', value: payload.totalWithoutTax, price: true },
                            {
                                label: `Tax (${payload.tax}%)`,
                                value: payload.total - payload.totalWithoutTax,
                                price: true,
                            },
                            { label: 'Total', value: payload.total, price: true },
                            { label: 'Amount Paid', value: paidAmount, price: true },
                            { label: 'Balance Due', value: payload.balanceDue, price: true, highlight: true },
                        ],
                        button: paymentLink
                            ? { label: 'Click Here to Pay', value: paymentLink, bgColor: 'white' }
                            : undefined,
                    },
                },
            },
        });
        return invoice.generate();
    }

    public toDBModel(): Array<Point> {
        const invoicePoint = this.influxService.getPoint(Invoice._measurement);
        invoicePoint.tag('businessID', this.businessID);
        invoicePoint.tag('invoiceId', this.invoiceId);
        invoicePoint.tag('fromEntity', this.fromEntity);
        invoicePoint.tag('toEntity', this.toEntity);
        invoicePoint.tag('invoiceStatus', this.invoiceStatus);
        invoicePoint.tag('invoiceS3bucket', this.invoiceS3bucket);
        invoicePoint.tag('invoiceS3key', this.invoiceS3key);
        invoicePoint.tag('customerId', this.customerId);
        invoicePoint.tag('currency', this.currency);
        invoicePoint.tag('salesTaxRate', this.salesTaxRate ? this.salesTaxRate.toString() : '0');

        if (this.invoicePaymentTerm) {
            invoicePoint.tag('invoicePaymentTerm', this.invoicePaymentTerm);
        }
        invoicePoint.tag(
            'invoiceLineItems',
            this.invoiceLineItems ? JSON.stringify(this.invoiceLineItems.getLineItems()) : JSON.stringify([]),
        );
        if (this.invoiceLineItems?.getTerms()) {
            invoicePoint.tag('invoiceLineItemTerms', this.invoiceLineItems.getTerms());
        }
        if (this.isManual) {
            invoicePoint.tag('isManual', 'true');
        }
        invoicePoint.tag('invoiceDate', this.invoiceDate.toISOString());
        invoicePoint.tag('totalAmountWithoutTax', this.totalAmountWithoutTax.toString());
        invoicePoint.tag('taxAmount', this.taxAmount.toString());
        invoicePoint.stringField('invoiceId', this.invoiceId);
        return [invoicePoint];
    }

    public toQueueModel(): Array<Point> {
        const invoicePoint = this.influxService.getPoint(Invoice._queueMeasurement);
        invoicePoint.tag('businessID', this.businessID);
        invoicePoint.tag('invoiceId', this.invoiceId);
        invoicePoint.tag('invoiceStatus', this.invoiceStatus);
        invoicePoint.tag('customerId', this.customerId);
        invoicePoint.tag('currency', this.currency);
        invoicePoint.tag('salesTaxRate', this.salesTaxRate ? this.salesTaxRate.toString() : '0');

        if (this.invoicePaymentTerm) {
            invoicePoint.tag('invoicePaymentTerm', this.invoicePaymentTerm);
        }
        invoicePoint.tag(
            'invoiceLineItems',
            this.invoiceLineItems ? JSON.stringify(this.invoiceLineItems.getLineItems()) : JSON.stringify([]),
        );
        if (this.invoiceLineItems?.getTerms()) {
            invoicePoint.tag('invoiceLineItemTerms', this.invoiceLineItems.getTerms());
        }
        invoicePoint.tag('invoiceDate', this.invoiceDate.toISOString());
        invoicePoint.tag('totalAmountWithoutTax', this.totalAmountWithoutTax.toString());
        invoicePoint.tag('taxAmount', this.taxAmount.toString());
        invoicePoint.stringField('invoiceId', this.invoiceId);
        return [invoicePoint];
    }

    public static fromDBModel(dbModel: InvoiceInfluxRow): Invoice {
        const invoiceLineItems = new InvoiceLineItems();
        if (dbModel.invoiceLineItems) {
            const parsed = JSON.parse(dbModel.invoiceLineItems);
            parsed.forEach((item) => {
                invoiceLineItems.addLineItem(
                    new InvoiceLineItem(item.name, item.quantity, item.unitCost, item.description),
                );
            });
        }
        if (dbModel.invoiceLineItemTerms) {
            invoiceLineItems.addTerms(dbModel.invoiceLineItemTerms);
        }
        return new Invoice({
            businessID: dbModel.businessID,
            invoiceId: dbModel.invoiceId,
            invoiceStatus: dbModel.invoiceStatus,
            invoiceS3bucket: dbModel.invoiceS3bucket,
            invoiceS3key: dbModel.invoiceS3key,
            customerId: dbModel.customerId,
            invoiceDate: dbModel.invoiceDate,
            totalAmountWithoutTax: Number(dbModel.totalAmountWithoutTax),
            taxAmount: Number(dbModel.taxAmount),
            invoicePaymentTerm: dbModel.invoicePaymentTerm,
            invoiceLineItems: invoiceLineItems,
            currency: dbModel.currency,
            fromEntity: dbModel.fromEntity,
            toEntity: dbModel.toEntity,
            salesTaxRate: Number(dbModel.salesTaxRate) ? Number(dbModel.salesTaxRate) : 0,
            isManual: dbModel?.isManual,
        });
    }

    public loadPropertiesFromSettingsEntity(settingsEntity: ReadSettingsResponseData): void {
        this.fromStreetLine1 = settingsEntity.addressLine1;
        this.fromStreetLine2 = settingsEntity.addressLine2;
        this.fromCity = settingsEntity.city;
        this.fromState = settingsEntity.state;
        this.fromPostalCode = settingsEntity.postalCode;
        this.fromCountry = settingsEntity.country;
        this.defaultTaxRate = settingsEntity.taxRate;
        this.taxCalculationType = settingsEntity.taxCalculationType;
        this.taxCategory = settingsEntity.taxCategory;
        this.businessName = settingsEntity.businessName;
        this.vatId = settingsEntity.vatId;
        this.logoUrl = settingsEntity.logoUrl;
        if (this.invoicePaymentTerm === InvoicePaymentTerm.none) {
            this.invoicePaymentTerm = settingsEntity.invoicePaymentTerm;
        }
        this.stripeAccountId = settingsEntity.stripeAccountId;
        this.accountState = settingsEntity.accountState;
        this.invoiceApproval = settingsEntity.invoiceApproval;
        this.supportEmail = settingsEntity.supportEmail;
    }

    public loadPropertiesFromCustomerEntity(customerEntity: ReadCustomerResponseData): void {
        this.toStreetLine1 = customerEntity.address?.streetLineOne ? customerEntity.address?.streetLineOne : '';
        this.toStreetLine2 = customerEntity.address?.streetLineTwo ? customerEntity.address?.streetLineTwo : '';
        this.toCity = customerEntity.address?.city ? customerEntity.address?.city : '';
        this.toState = customerEntity.address?.state ? customerEntity.address?.state : '';
        this.toPostalCode = customerEntity.address?.postalCode ? customerEntity.address?.postalCode : '';
        this.toCountry = customerEntity.address?.countryCode ? customerEntity.address?.countryCode : '';
        this.customerId = customerEntity.customerId;
        this.customerName = customerEntity.customerName;
        this.customerEmail = customerEntity.email;
        this.paymentChannel = customerEntity.paymentChannel;
        this.paymentChannelOptions = customerEntity.paymentChannelOptions;
        this.customerVatId = customerEntity.customerVatId;
        this.taxExempt = customerEntity.taxExempt;
    }

    public static async update(
        { invoiceStatus: newStatus, businessID, invoiceId, ...rest }: UpdateInvoicesDto,
        currentInvoice: Invoice,
        customerEntity: ReadCustomerResponseData,
        settingsEntity: ReadSettingsResponseData,
        taxService: TaxService,
    ): Promise<string> {
        const { invoiceStatus: currentStatus } = currentInvoice;
        Invoice.logger.log(`Starting Update for Invoice, current status: ${currentStatus}, new status: ${newStatus}`);
        if (
            currentStatus !== InvoiceStatus.DRAFT &&
            (rest['lineItems'] || rest['invoicePaymentTerm'] || rest['invoiceDate'])
        ) {
            throw new BadRequestException("Can only update Invoice fields when status is 'DRAFT'");
        }

        if (newStatus && (rest['lineItems'] || rest['invoicePaymentTerm'] || rest['invoiceDate'])) {
            Invoice.logger.log(
                `Debugging: ${JSON.stringify(rest)}, rest: ${rest} ObjectKeys: ${Object.keys(rest).length}`,
            );
            throw new BadRequestException('Cannot update Status and Invoice Fields at the same time');
        }
        if (rest['lineItems'] || rest['invoicePaymentTerm'] || rest['invoiceDate']) {
            let invoiceLineItems = currentInvoice?.invoiceLineItems;
            if (rest['lineItems']) {
                invoiceLineItems = new InvoiceLineItems();
                const { lineItems } = rest;
                lineItems.forEach((item) => {
                    invoiceLineItems.addLineItem(new InvoiceLineItem(item.name, item.quantity, item.unitCost));
                });
            }
            const updatedInvoice = new Invoice({
                ...currentInvoice,
                invoiceDate: currentInvoice.invoiceDate.toISOString(),
                invoiceStatus: currentStatus,
                ...rest,
                invoiceLineItems: invoiceLineItems,
                businessID,
                invoiceId,
                isManual: currentInvoice?.isManual ? 'true' : undefined,
            });

            updatedInvoice.loadPropertiesFromCustomerEntity(customerEntity);
            updatedInvoice.loadPropertiesFromSettingsEntity(settingsEntity);
            if (rest.invoicePaymentTerm) {
                updatedInvoice.invoicePaymentTerm = rest.invoicePaymentTerm;
            }
            await updatedInvoice.generate(taxService);

            return 'Invoice Updated';
        } else if (newStatus) {
            Invoice.logger.log(`Updating Invoice Status to: ${newStatus}`);

            const updatedInvoice = new Invoice({
                ...currentInvoice,
                isManual: currentInvoice?.isManual ? 'true' : undefined,
                invoiceDate: currentInvoice.invoiceDate.toISOString(),
                invoiceStatus: currentStatus,
                businessID,
                invoiceId,
            });
            updatedInvoice.loadPropertiesFromCustomerEntity(customerEntity);
            updatedInvoice.loadPropertiesFromSettingsEntity(settingsEntity);
            updatedInvoice.invoicePaymentTerm = currentInvoice.invoicePaymentTerm;
            const msg = await updatedInvoice.updateStatus(newStatus, taxService);
            return msg;
        }
        Invoice.logger.log(`Debugging: ${JSON.stringify(rest)}`);
    }
}
