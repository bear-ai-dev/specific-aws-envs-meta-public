import { Test, TestingModule } from '@nestjs/testing';
import { PaymentService } from './payment.service.js';
import { StripePaymentProcessor } from './entities/payment.entity.js';
import { Invoice } from '../invoice/entities/invoice.entity.js';
import { SupportedCurrencies } from '../offering/dto/SupportedCurrencies.js';
import { paymentChannel } from '../customer/dto/create-customer.dto.js';
import { AccountState } from '../setting/entities/AccountState.js';
import { CreditService } from '../credit/credit.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { CustomerCommunicationChannel } from '../customer/entities/customerCommunication.interface.js';
import { createMock } from '@golevelup/ts-jest';
import { WebhookPublishingService } from '../webhook/webhook.service.js';
import { WebhookType } from '../webhook/dto/create-webhook.dto.js';
import { async } from 'rxjs';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { TaxService } from '../tax/tax.service.js';
import { InvoiceGeneration, SendInvoiceEmail } from '../setting/dto/update-settings.dto.js';
import { SettingsEntity } from '../setting/entities/settings.entity.js';
import { SettingsService } from 'setting/settings.service.js';

jest.mock('stripe', () =>
    jest.fn().mockImplementation(() => ({
        customers: { listPaymentMethods: jest.fn(() => ({ data: [{ id: '123' }] })) },
        paymentIntents: { create: jest.fn(() => ({ id: 'foobarTest' })) },
    })),
);

jest.mock('@influxdata/influxdb-client', () => ({
    Point: jest.fn(() => ({
        tag: jest.fn(),
        stringField: jest.fn(),
    })),
    InfluxDB: jest.fn().mockImplementation(() => ({
        getWriteApi: jest.fn(() => ({ writePoints: jest.fn(), close: jest.fn(), flush: jest.fn() })),
    })),
}));

describe('PaymentService', () => {
    let service: PaymentService;
    const mockDraftEmail = {
        subject: 'Your invoice',
        fromName: 'some business',
        fromEmail: 'some@from.com',
        toEmail: 'some@to.com',
        content: '<h1>Your invoice is here</h1>',
        replyToName: 'some reply to',
        replyToEmail: 'some@reply.com',
    };
    const mockSettings = {
        businessName: 'Test Business',
        taxRate: '0',
        addressLine1: '123 Main St',
        addressLine2: 'Suite 1',
        city: 'San Francisco',
        state: 'CA',
        country: 'USA',
        postalCode: '94105',
        vatId: '123456789',
        logoUrl: 'https://www.example.com/logo.png',
        invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
        sendInvoiceEmail: SendInvoiceEmail.send,
    };
    const mockSettingsDoNotSend = {
        businessName: 'Test Business',
        taxRate: '0',
        addressLine1: '123 Main St',
        addressLine2: 'Suite 1',
        city: 'San Francisco',
        state: 'CA',
        country: 'USA',
        postalCode: '94105',
        vatId: '123456789',
        logoUrl: 'https://www.example.com/logo.png',
        invoiceGeneration: InvoiceGeneration.consolidatedPerBillingCycle,
        sendInvoiceEmail: SendInvoiceEmail.doNotSend,
    };
    const creditMockCreate = jest.fn(() => ({ trasactionRow: { id: '123' } }));
    const paymentMockCreate = jest.fn();
    const tokenServiceMockCreate = jest.fn();
    let findCreditBalanceMock = jest.fn(() => ({ balance: '100' }));
    const mockSettingsFindOne = jest.fn(() => new SettingsEntity(mockSettings));
    const mockSettingsFindOneDoNotSend = jest.fn(() => new SettingsEntity(mockSettingsDoNotSend));
    const settingsServiceMockCreate = jest.fn();
    const taxMock = { registerTransaction: jest.fn() } as unknown as TaxService;
    const creditMock = jest
        .fn()
        .mockImplementation(() => ({ create: creditMockCreate, findCreditBalance: findCreditBalanceMock }));
    const localJWTAuthServiceMock = jest
        .fn()
        .mockImplementation(() => ({ generateCustomerTokenWithInvoiceId: jest.fn() }));
    const mockPublish = jest.spyOn(CustomerService.customerCommunicationSystem, 'publish');
    const mockWebhook = jest.spyOn(WebhookPublishingService, 'publishEvent');
    const paymentServiceMock = jest.fn().mockImplementation(() => ({
        createAmountPaidTransaction: paymentMockCreate,
    }));
    const tokenConsumerServiceMock = jest.fn().mockImplementation(() => ({
        create: tokenServiceMockCreate,
    }));
    const settingsServiceMock = jest.fn().mockImplementation(() => ({
        create: settingsServiceMockCreate,
        findLatestSetting: mockSettingsFindOne,
    }));
    const settingsServiceDoNotSendMock = jest.fn().mockImplementation(() => ({
        create: settingsServiceMockCreate,
        findLatestSetting: mockSettingsFindOneDoNotSend,
    }));

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [PaymentService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<PaymentService>(PaymentService);
    });
    afterEach(() => {
        findCreditBalanceMock = jest.fn(() => ({ balance: '100' }));
        jest.clearAllMocks();
    });
    afterAll(() => {
        jest.resetAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    it('should process stripe payments sucessfully', async () => {
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.taxService = taxMock;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 100,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).toBeDefined();
        expect(paymentResult).toEqual({ id: 'foobarTest' });
        expect(invoice.draftEmail).toHaveBeenCalledWith(invoice.total, localJWTAuthServiceMock);
        expect(mockPublish).toHaveBeenCalledWith({
            topic: CustomerCommunicationChannel.EMAIL,
            data: [{ ...mockDraftEmail, html: true }],
            message: 'Sending email to customer',
        });
    });
    it('should process stripe payments sucessfully and not send email if sendInvoiceEmail is set to: doNotSend', async () => {
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.taxService = taxMock;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceDoNotSendMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 100,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).toBeDefined();
        expect(paymentResult).toEqual({ id: 'foobarTest' });
        expect(invoice.draftEmail).not.toHaveBeenCalledWith(invoice.total, localJWTAuthServiceMock);
        expect(mockPublish).not.toHaveBeenCalledWith({
            topic: CustomerCommunicationChannel.EMAIL,
            data: [{ ...mockDraftEmail, html: true }],
            message: 'Sending email to customer',
        });
    });
    it('Should not take any action if the stripeAccountId is undefined', async () => {
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 100,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: undefined,
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).not.toBeDefined();
        expect(invoice.draftEmail).toHaveBeenCalledWith(0, localJWTAuthServiceMock);
        expect(mockPublish).toHaveBeenCalledWith({
            topic: CustomerCommunicationChannel.EMAIL,
            data: [{ ...mockDraftEmail, html: true }],
            message: 'Sending email to customer',
        });
    });
    it('Should calculate the difference between credit and stripe payment', async () => {
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 100,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).toBeDefined();
        expect(findCreditBalanceMock).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledWith(expect.objectContaining({ transactionAmount: '-100.00' }));
        expect(invoice.draftEmail).toHaveBeenCalledWith(invoice.total, localJWTAuthServiceMock);
        expect(mockPublish).toHaveBeenCalledWith({
            topic: CustomerCommunicationChannel.EMAIL,
            data: [{ ...mockDraftEmail, html: true }],
            message: 'Sending email to customer',
        });
    });
    it('Should not commit to the credit service if the balance is zero', async () => {
        findCreditBalanceMock = jest.fn(() => ({ balance: '0' }));
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 100,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).toBeDefined();
        expect(findCreditBalanceMock).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledTimes(0);
        expect(invoice.draftEmail).toHaveBeenCalledWith(invoice.total, localJWTAuthServiceMock);
        expect(mockPublish).toHaveBeenCalledWith({
            topic: CustomerCommunicationChannel.EMAIL,
            data: [{ ...mockDraftEmail, html: true }],
            message: 'Sending email to customer',
        });
    });
    it('Should call the credit service if the balance is greater than the charge balance', async () => {
        findCreditBalanceMock = jest.fn(() => ({ balance: '1000000' }));
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 100,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).not.toBeDefined();
        expect(findCreditBalanceMock).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledWith(expect.objectContaining({ transactionAmount: '-110.00' }));
        expect(invoice.draftEmail).toHaveBeenCalledWith(invoice.total, localJWTAuthServiceMock);
        expect(mockPublish).toHaveBeenCalledWith({
            topic: CustomerCommunicationChannel.EMAIL,
            data: [{ ...mockDraftEmail, html: true }],
            message: 'Sending email to customer',
        });
    });

    it('Should log amount paid transactions for credit and stripe payments', async () => {
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 999999999,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).toBeDefined();
        expect(findCreditBalanceMock).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledWith(expect.objectContaining({ transactionAmount: '-100.00' }));
        expect(invoice.draftEmail).toHaveBeenCalledWith(invoice.total, localJWTAuthServiceMock);
        expect(mockPublish).toHaveBeenCalledWith({
            topic: CustomerCommunicationChannel.EMAIL,
            data: [{ ...mockDraftEmail, html: true }],
            message: 'Sending email to customer',
        });
        expect(paymentMockCreate).toHaveBeenCalledTimes(2);
        expect(paymentMockCreate).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                transactionAmount: 100,
                invoiceId: invoice.invoiceId,
                businessID: 'foobar',
            }),
        );
        expect(paymentMockCreate).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                transactionAmount: 999999909,
                invoiceId: invoice.invoiceId,
                businessID: 'foobar',
            }),
        );
    });
    it('Should not throw for invoices with zero total and zero tax', async () => {
        const stripePaymentSystem = new StripePaymentProcessor();
        findCreditBalanceMock = jest.fn(() => ({ balance: '0' }));
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 0,
            taxAmount: 0,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(paymentResult).not.toBeDefined();
        expect(findCreditBalanceMock).toHaveBeenCalledTimes(1);
        expect(creditMockCreate).toHaveBeenCalledTimes(0);
        expect(invoice.draftEmail).toHaveBeenCalledWith(invoice.total, localJWTAuthServiceMock);
        expect(invoice.total).toEqual(0);
    });
    it('Should publish events to the webhook service for sucessfully processed invoices', async () => {
        const stripePaymentSystem = new StripePaymentProcessor();
        stripePaymentSystem.creditService = new creditMock() as unknown as CreditService;
        stripePaymentSystem.paymentService = new paymentServiceMock() as unknown as PaymentService;
        stripePaymentSystem.localJWTAuthService = localJWTAuthServiceMock as unknown as LocalJWTAuthService;
        stripePaymentSystem.tokenConsumerService = tokenConsumerServiceMock as unknown as TokenConsumerService;
        stripePaymentSystem.settingsService = settingsServiceMock() as unknown as SettingsService;
        const businessID = '123';
        const invoice = new Invoice({
            businessID,
            customerId: '123',
            currency: SupportedCurrencies.USD,
            totalAmountWithoutTax: 999999999,
            taxAmount: 10,
        });
        jest.spyOn(invoice, 'draftEmail').mockResolvedValueOnce(mockDraftEmail);

        const paymentResult = await stripePaymentSystem.process({
            topic: paymentChannel.Stripe,
            data: [
                {
                    stripeCustomerId: '123',
                    stripeAccountId: '123',
                    businessID: 'foobar',
                    invoice,
                    accountState: AccountState.sandbox,
                    customerId: '123',
                },
            ],
        });
        expect(mockWebhook).toBeCalledTimes(1);
        expect(mockWebhook).toBeCalledWith(
            expect.objectContaining({
                businessID: 'foobar',
                data: [
                    {
                        amountPaid: 1000000009,
                        currency: 'USD',
                        customerId: '123',
                        invoiceDate: expect.anything(),
                        invoiceId: expect.anything(),
                        invoiceStatus: 'Paid',
                        payments: expect.arrayContaining([{}, {}]),
                        taxAmount: 10,
                        totalAmountWithoutTax: 999999999,
                    },
                ],
                topic: 'Standard',
                type: WebhookType.INVOICE_PAID,
            }),
        );
    });
});
