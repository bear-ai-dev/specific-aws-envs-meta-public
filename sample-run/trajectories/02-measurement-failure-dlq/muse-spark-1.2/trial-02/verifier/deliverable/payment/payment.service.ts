import { BadRequestException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { CreditService } from '../credit/credit.service.js';
import { paymentChannel } from '../customer/dto/create-customer.dto.js';
import { TaxService } from '../tax/tax.service.js';
import { ManualPaymentProcessor, StripePaymentProcessor } from './entities/payment.entity.js';
import { AmountPaidLedgerEntity } from './entities/AmountPaidLedgerEntity.js';
import { PaymentProcessRequest } from './entities/payment.interface.js';
import { InfluxService } from '../influx/influx.service.js';
import { AmountPaidTransaction } from './dto/createPayment.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';
import { AmountPaidLedgerResponse } from './dto/amountPaidLedgerResponse.dto.js';
import { ReadCustomerResponseData } from '../customer/entities/customer.entity.js';
import { CustomerService } from '../customer/customer.service.js';
import { InvoiceLineItem } from '../invoice/entities/invoice.entity.js';
import { AccountState } from '../setting/entities/AccountState.js';
import Stripe from 'stripe';
import { ReadSettingsResponseData } from '../setting/dto/read-setting.dto.js';
import { SupportedCurrencies } from '../offering/dto/SupportedCurrencies.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { SettingsService } from '../setting/settings.service.js';
export enum PaymentStatus {
    success = 'success',
    canceled = 'canceled',
}

@Injectable()
export class PaymentService {
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => LocalJWTAuthService)) readonly localJWTAuthService: LocalJWTAuthService,
        @Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService,
    ) {}
    private static readonly logger = new Logger(PaymentService.name);
    public static stripePaymentProcessor = new StripePaymentProcessor();
    public static manualPaymentProcessor = new ManualPaymentProcessor();

    public static subscribe(
        creditService: CreditService,
        taxService: TaxService,
        paymentService: PaymentService,
        localJWTAuthService: LocalJWTAuthService,
        tokenService: TokenConsumerService,
        settingsService: SettingsService,
    ) {
        PaymentService.stripePaymentProcessor.creditService = creditService;
        PaymentService.stripePaymentProcessor.taxService = taxService;
        PaymentService.stripePaymentProcessor.paymentService = paymentService;
        PaymentService.stripePaymentProcessor.localJWTAuthService = localJWTAuthService;
        PaymentService.stripePaymentProcessor.tokenConsumerService = tokenService;
        PaymentService.manualPaymentProcessor.paymentService = paymentService;
        PaymentService.manualPaymentProcessor.localJWTAuthService = localJWTAuthService;
        PaymentService.stripePaymentProcessor.on(paymentChannel.Stripe, this.stripePaymentProcessor.process);
        PaymentService.manualPaymentProcessor.on(paymentChannel.manual, this.manualPaymentProcessor.process);
        PaymentService.manualPaymentProcessor.settingsService = settingsService;
        PaymentService.stripePaymentProcessor.settingsService = settingsService;
    }
    public static publishEvent({ topic, data }: PaymentProcessRequest) {
        PaymentService.logger.log(`Publishing event for ${topic}`);
        if (topic === paymentChannel.Stripe) {
            PaymentService.stripePaymentProcessor.emit(topic, { data });
        }
        if (topic === paymentChannel.manual) {
            PaymentService.manualPaymentProcessor.emit(topic, { data });
        }
    }

    public async getAmountPaid({ invoiceId, businessID }: { invoiceId: string; businessID: string }) {
        PaymentService.logger.log(`amountPaid for ${invoiceId}  in businessID: ${businessID}`);
        try {
            const res = AmountPaidLedgerEntity.sumLedgerAmountPaidByInvoiceId({
                influxService: this.InfluxService,
                invoiceId,
                businessID,
            });
            return res;
        } catch (e) {
            PaymentService.logger.error(
                `amountPaid for ${invoiceId}  in businessID: ${businessID} failed with error ${serializeError(e)}`,
            );
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to get amount paid',
                data: [{ invoiceId, businessID, error: serializeError(e) }],
            });
            throw e;
        }
    }

    async getAmountPaidForCustomerInvoices({ customerId, businessID }: { customerId: string; businessID: string }) {
        PaymentService.logger.log(`amountPaid for  customer: ${customerId}  in businessID: ${businessID}`);
        try {
            const res = await AmountPaidLedgerEntity.sumLedgerAmountPaidByCustomerId({
                influxService: this.InfluxService,
                customerId,
                businessID,
            });
            return res;
        } catch (e) {
            PaymentService.logger.error(
                `amountPaid for  customer: ${customerId}  in businessID: ${businessID} failed with error ${serializeError(
                    e,
                )}`,
            );
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to get amount paid',
                data: [{ customerId, businessID, error: serializeError(e) }],
            });
            throw e;
        }
    }

    public async getPaymentTransactions({
        invoiceId,
        businessID,
    }: {
        invoiceId: string;
        businessID: string;
    }): Promise<AmountPaidLedgerResponse[]> {
        PaymentService.logger.log(`getPaymentTransactions for ${invoiceId}  in businessID: ${businessID}`);
        try {
            const res = await AmountPaidLedgerEntity.getAmountPaidLedger({
                influxService: this.InfluxService,
                invoiceId,
                businessID,
            });
            return res.map((e) => new AmountPaidLedgerResponse(e));
        } catch (e) {
            PaymentService.logger.error(
                `getPaymentTransactions for ${invoiceId}  in businessID: ${businessID} failed with error ${serializeError(
                    e,
                )}`,
            );
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to get payment transactions',
                data: [{ invoiceId, businessID, error: serializeError(e) }],
            });
            throw e;
        }
    }

    public async createAmountPaidTransaction(
        transaction: AmountPaidTransaction,
    ): Promise<{ invoiceId: string; message: string; amountPaidLedgerRow: AmountPaidLedgerResponse }> {
        PaymentService.logger.log(
            `createAmountPaidTransaction for ${transaction?.invoiceId}  in businessID: ${transaction?.businessID}`,
        );
        let amountPaidEntity;
        try {
            amountPaidEntity = new AmountPaidLedgerEntity(transaction);
            const points = AmountPaidLedgerEntity.transform(amountPaidEntity, this.InfluxService);
            await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        } catch (e) {
            PaymentService.logger.error(
                `createAmountPaidTransaction for ${transaction?.invoiceId}  in businessID: ${transaction?.businessID} failed with error ${serializeError(
                    e,
                )}`,
            );
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to create amount paid transaction',
                data: [{ transaction, error: serializeError(e) }],
            });
            throw e;
        }
        return {
            message: 'Successfully created amount paid transaction',
            invoiceId: transaction.invoiceId,
            amountPaidLedgerRow: new AmountPaidLedgerResponse(amountPaidEntity),
        };
    }

    public async getCheckoutSessionPage({
        customerId,
        businessID,
        amountToPay,
        invoiceId,
        customer,
        settings,
    }: {
        customerId: string;
        businessID: string;
        amountToPay: number;
        invoiceId: string;
        customer?: ReadCustomerResponseData;
        settings: ReadSettingsResponseData;
    }): Promise<{ url: string; sessionId: string; paymentCompletedAlready?: boolean }> {
        PaymentService.logger.log(`getCheckoutSessionPage for invoice: ${invoiceId}  in businessID: ${businessID}`);
        let readCustomerRes: ReadCustomerResponseData;
        const { stripeAccountId, stripeConnected, accountState } = settings;
        if (!customer) {
            const { data } = await this.customerService.findOne({ customerId, businessID });
            readCustomerRes = data[0];
        } else {
            readCustomerRes = customer;
        }
        if (stripeConnected) {
            PaymentService.logger.log(`Stripe connected for ${invoiceId}  in businessID: ${businessID}`);
            const stripe = new Stripe(
                accountState === AccountState.production ? process.env.PROD_STRIPE_TOKEN : process.env.STRIPE_TOKEN,
                { apiVersion: '2022-08-01' },
            );

            PaymentService.logger.log(`Stripe created for ${invoiceId}  in businessID: ${businessID}`);
            try {
                // Attempt to get a stripe session for the customer and invoiceId
                const stripeSessions = await stripe.checkout.sessions.list(
                    {
                        customer_details: {
                            email: readCustomerRes?.email,
                        },
                        expand: ['data.payment_intent'],
                        limit: 100,
                    },
                    { stripeAccount: stripeAccountId },
                );
                PaymentService.logger.log(`Stripe sessions for ${invoiceId}  in businessID: ${businessID}`);
                const stripeSession = stripeSessions.data.reduce(
                    (acc, session) => {
                        if (acc.paymentIntentSuccess) {
                            return acc;
                        }
                        const sessionMetadata = session.metadata;
                        const sessionPaymentIntent = session.payment_intent as Stripe.PaymentIntent;
                        if (sessionMetadata?.invoiceId === invoiceId) {
                            return { paymentIntentSuccess: sessionPaymentIntent?.status === 'succeeded', session };
                        }

                        return acc;
                    },
                    { paymentIntentSuccess: false, session: undefined },
                );
                if (stripeSession) {
                    if (stripeSession.paymentIntentSuccess) {
                        PaymentService.logger.log(`Returning stripe session with ${stripeSession.session.id}`);
                        return {
                            url: ``,
                            sessionId: stripeSession.session.id,
                            paymentCompletedAlready: true,
                        };
                    } else if (stripeSession.session) {
                        const { url, id: sessionId, status } = stripeSession.session as Stripe.Checkout.Session;
                        PaymentService.logger.log(`Returning stripe session with ${sessionId}`);
                        if (status === 'open') {
                            return { url, sessionId };
                        }
                    }
                }
            } catch (e) {
                PaymentService.logger.error(`Failed to get stripe session ${serializeError(e)}`);
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Failed to get stripe session',
                    data: [{ invoiceId, error: serializeError(e) }],
                });
            }
            let lineItemName;
            if (settings?.businessName) {
                lineItemName = `${settings?.businessName} -  Invoice: ${invoiceId} - Balance Payment`;
            } else {
                lineItemName = `Invoice: ${invoiceId} - Balance Payment`;
            }
            const stripeLineItems = [
                {
                    price_data: {
                        currency: customer.currency ? customer.currency : SupportedCurrencies.USD,
                        product_data: {
                            name: lineItemName,
                        },
                        unit_amount: parseInt(StripePaymentProcessor.calculateStripeTotal(amountToPay).toFixed(0)),
                    },
                    quantity: 1,
                },
            ];
            const { access_token } = await this.localJWTAuthService.generateCustomerTokenWithInvoiceId(
                customerId,
                businessID,
                invoiceId,
            );
            const successUrl = `${process.env.METERINGCO_URL}/portal/customer/payment?paymentStatus=${PaymentStatus.success}&state=${access_token}&sessionId={CHECKOUT_SESSION_ID}`;
            const cancelUrl = `${process.env.METERINGCO_URL}/portal/customer/payment?paymentStatus=${PaymentStatus.canceled}&state=${access_token}&sessionId={CHECKOUT_SESSION_ID}`;
            const stripeSessionInput = {
                customer_email: !readCustomerRes?.paymentChannelOptions?.stripeCustomerId
                    ? readCustomerRes?.email
                    : undefined,
                customer:
                    readCustomerRes?.paymentChannel === paymentChannel.Stripe
                        ? readCustomerRes?.paymentChannelOptions?.stripeCustomerId
                        : undefined,
                payment_method_types: ['card'] as Stripe.Checkout.SessionCreateParams.PaymentMethodType[],
                line_items: stripeLineItems,
                mode: 'payment' as Stripe.Checkout.Session.Mode,
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                    invoiceId,
                },
                payment_intent_data: {
                    metadata: {
                        invoiceId,
                        processedByMeteringCo: 'true',
                    },
                },
            };

            let stripeRes;
            try {
                PaymentService.logger.log(`Creating stripe session with ${JSON.stringify(stripeSessionInput)}`);
                stripeRes = await stripe.checkout.sessions.create(stripeSessionInput, {
                    stripeAccount: stripeAccountId,
                });
                PaymentService.logger.log(`Created stripe session with ${JSON.stringify(stripeRes)}`);
            } catch (e) {
                PaymentService.logger.error(`Failed to create stripe session ${serializeError(e)}`);
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Failed to create stripe session',
                    data: [{ stripeSessionInput, error: serializeError(e) }],
                });
                throw e;
            }
            PaymentService.logger.log(`Returning stripe session with ${stripeRes.id}, and URL: ${stripeRes.url}`);
            return { url: stripeRes.url, sessionId: stripeRes.id };
        } else {
            PaymentService.logger.log(`Stripe not connected for invoice: ${invoiceId}  in businessID: ${businessID}`);
            return { url: '', sessionId: '' };
        }
    }

    public async validateStripePaymentCompleteForInvoice({
        invoiceId,
        customerId,
        customer,
        settings,
        businessID,
    }: {
        invoiceId: string;
        customerId: string;
        customer?: ReadCustomerResponseData;
        settings: ReadSettingsResponseData;
        businessID: string;
    }): Promise<boolean> {
        PaymentService.logger.log(`validatePaymentComplete for ${invoiceId}  in businessID: ${settings.businessID}`);
        let readCustomerRes: ReadCustomerResponseData;
        const { stripeAccountId, stripeConnected, accountState } = settings;
        if (!customer) {
            const { data } = await this.customerService.findOne({ customerId, businessID });
            readCustomerRes = data[0];
        } else {
            readCustomerRes = customer;
        }
        if (stripeConnected) {
            PaymentService.logger.log(`Stripe connected for ${invoiceId}  in businessID: ${settings.businessID}`);
            if (
                readCustomerRes?.paymentChannel === paymentChannel.Stripe &&
                readCustomerRes?.paymentChannelOptions?.stripeCustomerId
            ) {
                const { paymentChannelOptions } = readCustomerRes;
                const paymentResponses = await StripePaymentProcessor.getPaymentsForCustomer({
                    stripeAccountId,
                    accountState,
                    stripeCustomerId: paymentChannelOptions.stripeCustomerId,
                    metadata: {
                        invoiceId,
                    },
                });
                PaymentService.logger.log(
                    `Stripe payment response for ${invoiceId}  in businessID: ${settings.businessID}`,
                );
                // TODO: Validate that the payment amount in stripe matches the invoice amount, and that the payment status is succeeded. Need to additionally check if there was credit
                // Which is why I am punting on this bit of logic
                paymentResponses.reduce((acc, payment) => {
                    if (payment.status === 'succeeded') {
                        return true;
                    }
                    return acc;
                }, false);
            } else {
                PaymentService.logger.log(
                    `Stripe not connected for customer: ${customerId}  in businessID: ${settings.businessID}`,
                );
                return false;
            }
        } else {
            PaymentService.logger.log(`Stripe not connected for ${invoiceId}  in businessID: ${settings.businessID}`);
            return false;
        }
        return false;
    }
}
