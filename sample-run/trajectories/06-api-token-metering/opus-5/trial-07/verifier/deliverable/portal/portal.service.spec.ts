import { Test, TestingModule } from '@nestjs/testing';
import { PortalService } from './portal.service.js';
import { createMock } from '@golevelup/ts-jest';
import { SettingsService } from '../setting/settings.service.js';
import { SettingsEntity } from '../setting/entities/settings.entity.js';
import { CustomerReadResponse, CustomerService } from '../customer/customer.service.js';
import { fullCustomerData } from '../../test/fixtures/data/customer.js';
import { openedInvoice, paidInvoice } from '../../test/fixtures/data/invoice.js';
import { InvoicesService } from '../invoice/invoices.service.js';
import { Invoice } from '../invoice/entities/invoice.entity.js';
import { stripePayment } from '../../test/fixtures/data/payment.js';
import { ReadInvoicesDto } from '../invoice/dto/read-invoices.dto.js';
import { NotFoundException } from '@nestjs/common';
import { TaxExempt } from '../customer/dto/TaxExempt.js';
import { simpleSetting } from '../../test/fixtures/data/setting.js';
import { UsageService } from '../usage/usage.service.js';
import { aggregatedUsages } from '../../test/fixtures/data/usage.js';
import { GetCustomerStripePortalResponse } from '../customer/dto/read-customer.dto.js';
import { Address } from '../customer/dto/create-customer.dto.js';
import { PortalPagesConfigurationDto } from './dto/configuration.dto.js';

describe('PortalService', () => {
    const businessID = 'some-business-id';
    const customerId = 'some-customer-id';

    let service: PortalService;
    let settingService: SettingsService;
    let customerService: CustomerService;
    let invoicesService: InvoicesService;
    let usageService: UsageService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [PortalService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get(PortalService);
        settingService = module.get(SettingsService);
        customerService = module.get(CustomerService);
        invoicesService = module.get(InvoicesService);
        usageService = module.get(UsageService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('findConfiguration', () => {
        const logoUrl = 'https://test-s3.com/logo.png';
        it('should return correct logo url', async () => {
            const setting = new SettingsEntity({ logoUrl });
            jest.spyOn(settingService, 'findLatestSetting').mockResolvedValueOnce(setting);

            const result = await service.findConfiguration(businessID);

            expect(result).toEqual({ message: 'Found portal configuration', logoUrl });
        });
    });

    describe('findCustomer', () => {
        const customer: CustomerReadResponse = { data: [fullCustomerData], message: 'Found Customer' };

        it('should return correct fields', async () => {
            jest.spyOn(customerService, 'findOne').mockResolvedValueOnce(customer);
            jest.spyOn(settingService, 'findLatestSetting').mockResolvedValueOnce(new SettingsEntity(simpleSetting));

            const result = await service.findCustomer(businessID, customerId);
            expect(result).toEqual({
                message: 'Found customer billing information',
                data: [
                    {
                        customerName: 'someone',
                        email: 'noreply@meteringco.example',
                        taxExempt: TaxExempt.exempt,
                        address: {
                            countryCode: 'US',
                            postalCode: '90210',
                            city: 'Beverly Hills',
                            streetLineOne: '1234 Main St',
                            streetLineTwo: 'Apt 1',
                            state: 'NY',
                        },
                        currency: 'USD',
                        freeTrialEndDate: '2020-12-31T23:59:59.999Z',
                        creditBalance: '100',
                        invoices: [openedInvoice, paidInvoice],
                        stripeAccountReady: true,
                        paymentChannel: 'Stripe',
                        offering: {
                            dimensions: [
                                {
                                    dimensionId: '8a7b5f91-3b85-4cf4-8585-dcdf17f49004',
                                    dimensionName: 'API Call',
                                    consumptionUnit: { unit: 'count-based', type: 'count' },
                                    usageIncrement: '24',
                                    usageEntitlement: 'inf',
                                    overageAllowed: 'true',
                                    paymentSchedule: 'upfront',
                                },
                            ],
                            offeringName: 'Entperise Plan',
                        },
                    },
                ],
            });
        });
    });

    describe('findInvoices', () => {
        it('should return list of invoices with limited fields', async () => {
            const opened = new Invoice(openedInvoice);
            const paid = new Invoice(paidInvoice);
            jest.spyOn(invoicesService, 'findAll').mockResolvedValueOnce([opened, paid]);

            const result = await service.findInvoices(businessID, customerId);

            expect(invoicesService.findAll).toHaveBeenCalledWith(businessID, customerId, true);
            expect(result).toEqual({
                message: 'Found invoices for customer',
                data: [
                    {
                        invoiceDate: '2021-01-01T00:00:00.000Z',
                        invoiceId: 'opened-invoice-id',
                        taxAmount: 10,
                        totalAmount: 110,
                        totalAmountWithoutTax: 100,
                    },
                    {
                        invoiceDate: '2021-02-01T00:00:00.000Z',
                        invoiceId: 'paid-invoice-id',
                        taxAmount: 20,
                        totalAmount: 220,
                        totalAmountWithoutTax: 200,
                    },
                ],
            });
        });

        it('should return empty list if customer does not have invoice', async () => {
            jest.spyOn(invoicesService, 'findAll').mockResolvedValueOnce([]);

            const result = await service.findInvoices(businessID, customerId);

            expect(invoicesService.findAll).toHaveBeenCalledWith(businessID, customerId, true);
            expect(result).toEqual({
                message: 'No invoices found for customer',
                data: [],
            });
        });
    });

    describe('findUsageOfCurrentBillingCycleForCustomer', () => {
        beforeEach(() => {
            jest.useFakeTimers('modern').setSystemTime(new Date('2023-08-16'));
            jest.spyOn(usageService, 'findUsageForCustomer').mockResolvedValue(aggregatedUsages);
        });

        afterEach(() => {
            jest.useRealTimers();
        });

        it("should return empty usage array if customer doesn't have offering", async () => {
            const customer: CustomerReadResponse = {
                data: [{ ...fullCustomerData, offering: undefined }],
                message: 'Found Customer',
            };
            jest.spyOn(customerService, 'findOne').mockResolvedValueOnce(customer);

            const result = await service.findUsageOfCurrentBillingCycle(businessID, customerId);

            expect(usageService.findUsageForCustomer).not.toHaveBeenCalled();
            expect(result).toEqual({
                message: 'Customer no Offerings found',
                data: [],
            });
        });

        it('should return usages correctly', async () => {
            const customer: CustomerReadResponse = { data: [fullCustomerData], message: 'Found Customer' };
            jest.spyOn(customerService, 'findOne').mockResolvedValueOnce(customer);

            const result = await service.findUsageOfCurrentBillingCycle(businessID, customerId);

            expect(usageService.findUsageForCustomer).toHaveBeenCalledWith(
                {
                    businessID,
                    customerId,
                    customer: fullCustomerData,
                },
                {
                    endTime: '2023-08-16T00:00:00.000Z',
                    startTime: '2023-08-01T00:00:00.000Z',
                },
            );
            expect(result).toEqual({
                message: 'Found customer usage data',
                data: [
                    {
                        dimensionId: '8a7b5f91-3b85-4cf4-8585-dcdf17f49004',
                        endTime: '2023-08-16T00:00:00.000Z',
                        startTime: '2023-08-01T00:00:00.000Z',
                        value: '444.99',
                    },
                ],
            });
        });

        it('should use offering enrollment date if it is later than start date of current billing cycle', async () => {
            const customerData = { ...fullCustomerData, offeringEnrollmentDate: new Date('2023-08-10').toISOString() };
            const customer: CustomerReadResponse = {
                data: [customerData],
                message: 'Found Customer',
            };
            jest.spyOn(customerService, 'findOne').mockResolvedValueOnce(customer);

            const result = await service.findUsageOfCurrentBillingCycle(businessID, customerId);

            expect(usageService.findUsageForCustomer).toHaveBeenCalledWith(
                {
                    businessID,
                    customerId,
                    customer: customerData,
                },
                {
                    endTime: '2023-08-16T00:00:00.000Z',
                    startTime: '2023-08-10T00:00:00.000Z',
                },
            );
            expect(result).toEqual({
                message: 'Found customer usage data',
                data: [
                    {
                        dimensionId: '8a7b5f91-3b85-4cf4-8585-dcdf17f49004',
                        endTime: '2023-08-16T00:00:00.000Z',
                        startTime: '2023-08-10T00:00:00.000Z',
                        value: '444.99',
                    },
                ],
            });
        });
    });

    describe('findInvoice', () => {
        it('should throw not found error if no invoice found', async () => {
            const invoiceId = 'some-invoice-id';
            jest.spyOn(invoicesService, 'findOne').mockResolvedValueOnce({
                data: [],
                message: 'Found invoice',
            });

            await expect(
                service.findInvoice({
                    businessID,
                    customerId: 'some-customer-id',
                    invoiceId,
                    download: false,
                }),
            ).rejects.toThrow(new NotFoundException(`Invoice ${invoiceId} not found`));
        });

        it("should throw not found error if the invoice's customer id doesn't match given customer id", async () => {
            const invoice = new ReadInvoicesDto(new Invoice(paidInvoice), null);
            jest.spyOn(invoicesService, 'findOne').mockResolvedValueOnce({
                data: [invoice],
                message: 'Found invoice',
            });

            await expect(
                service.findInvoice({
                    businessID,
                    customerId: 'some-customer-id',
                    invoiceId: invoice.invoiceId,
                    download: false,
                }),
            ).rejects.toThrow(new NotFoundException(`Invoice ${invoice.invoiceId} not found`));
        });

        it('return detailed invoice with payment information', async () => {
            const invoice = new ReadInvoicesDto(new Invoice(paidInvoice), null);
            jest.spyOn(invoicesService, 'findOne').mockResolvedValueOnce({
                data: [invoice],
                message: 'Found invoice',
            });

            const result = await service.findInvoice({
                businessID,
                customerId: invoice.customerId,
                invoiceId: invoice.invoiceId,
                download: false,
            });

            expect(invoicesService.findOne).toHaveBeenCalledWith(businessID, invoice.invoiceId, false);
            expect(result).toEqual({
                message: 'Found invoice',
                data: [{ ...invoice, payments: [stripePayment] }],
            });
        });

        it('handle no payments correctly', async () => {
            const invoice = new ReadInvoicesDto(new Invoice(openedInvoice), null);
            jest.spyOn(invoicesService, 'findOne').mockResolvedValueOnce({
                data: [invoice],
                message: 'Found invoice',
            });
            jest.spyOn(customerService, 'findPayments').mockResolvedValueOnce({
                messages: 'Stripe customer not found',
                data: [],
            });

            const result = await service.findInvoice({
                businessID,
                customerId: invoice.customerId,
                invoiceId: invoice.invoiceId,
                download: false,
            });

            expect(result).toEqual({
                message: 'Found invoice',
                data: [{ ...invoice, payments: [] }],
            });
        });
    });

    describe('getStripePortalUrl', () => {
        it('should return correct stripe portal url', async () => {
            const expectedResponse: GetCustomerStripePortalResponse = {
                message: 'Generated portal URL',
                portalUrl: 'https://billing.meteringco.example/stripe-portal?customerId=cus_xxxxxxxxxxxxxx',
            };
            jest.spyOn(customerService, 'getStripePortalUrl').mockResolvedValueOnce(expectedResponse);

            const result = await service.getStripePortalUrl(businessID, customerId);

            expect(customerService.getStripePortalUrl).toHaveBeenCalledWith({ businessID, customerId });
            expect(result).toEqual(expectedResponse);
        });
    });

    describe('updateCustomer', () => {
        const address: Address = {
            city: simpleSetting.city,
            countryCode: simpleSetting.country.toLowerCase(),
            postalCode: simpleSetting.postalCode,
            state: simpleSetting.state,
            streetLineOne: simpleSetting.addressLine1,
            streetLineTwo: simpleSetting.addressLine2,
        };

        it("should be able to update customer' address", async () => {
            jest.spyOn(customerService, 'update').mockResolvedValueOnce({
                message: 'Customer updated added',
                customerId: customerId,
                portalUrl: 'https://some-portal-url.com',
            });

            const result = await service.updateCustomer(businessID, customerId, { address });

            expect(result).toEqual({ customerId, message: 'Customer updated' });
            expect(customerService.update).toHaveBeenCalledWith({ businessID, address }, customerId, customerId);
        });
    });

    describe('Update Configuration', () => {
        it("should be able to update a business' appearance configuration", async () => {
            const sampleRequest: PortalPagesConfigurationDto = {
                businessID: 'foobar',
                subject: 'foobar1',
                pages: {
                    invoice: {
                        text: 'invoice',
                        enabled: true,
                    },
                    payment: {
                        text: 'payment',
                        enabled: true,
                    },
                    offering: {
                        text: 'offerings',
                        enabled: true,
                        offerings: [],
                        appearance: {
                            background: '#ffffff',
                        },
                    },
                },
            };
            const settingsUpdate = jest.spyOn(settingService, 'update');
            await expect(service.updateConfiguration(sampleRequest)).resolves.toEqual(
                expect.objectContaining({ message: expect.stringContaining('') }),
            );
            expect(settingsUpdate).toHaveBeenCalledWith(sampleRequest);
        });
    });
});
