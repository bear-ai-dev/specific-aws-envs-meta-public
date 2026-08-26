import { Test, TestingModule } from '@nestjs/testing';
import { InvoicesService } from './invoices.service.js';
import * as InvoiceEntityFile from './entities/invoice.entity.js';
import { InfluxService } from '../influx/influx.service.js';
import { TaxService } from '../tax/tax.service.js';
import { SettingsService } from '../setting/settings.service.js';
import { SettingsEntity } from '../setting/entities/settings.entity.js';
import { CustomerService } from '../customer/customer.service.js';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createMock } from '@golevelup/ts-jest';
import { CreditService } from '../credit/credit.service.js';
import { Invoice, InvoiceLineItem, InvoiceLineItems } from './entities/invoice.entity.js';
import { openedInvoice, paidInvoice } from '../../test/fixtures/data/invoice.js';
import { PaymentService } from '../payment/payment.service.js';
import { SupportedCurrencies } from '../offering/dto/SupportedCurrencies.js';
import { InvoiceGeneration } from '../setting/dto/update-settings.dto.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';

jest.mock('@aws-sdk/lib-storage', () => {
    // Works and lets you check for constructor calls:
    return {
        Upload: jest.fn().mockImplementation(() => {
            return {
                done: () => {
                    return '';
                },
            };
        }),
    };
});

jest.mock('@aws-sdk/s3-request-presigner', () => {
    // Works and lets you check for constructor calls:
    return {
        getSignedUrl: jest.fn().mockImplementation(() => {
            return 'https://www.example.com';
        }),
    };
});

describe('InvoicesService', () => {
    const mockFoundInfluxData: Array<any> = [
        {
            invoiceId: 'fake',
            businessID: 'myCoolCorp',
            _measurement: InvoiceEntityFile.Invoice._measurement,
            _time: new Date().toISOString(),
            currency: 'USD',
            invoiceLineItems: '[]',
            fromEntity: 'Test Business',
            toEntity: 'Test Customer',
        },
    ];
    const mockFileCheck = jest.spyOn(InvoiceEntityFile, 'checkIfInvoiceIsInBucket').mockResolvedValue(false);
    let service: InvoicesService;
    const mockTag = jest.fn();
    const mockLoadPoints = jest.fn();
    const getSingleInvoice = jest.fn(() => mockFoundInfluxData);
    const mockSettingsFindOne = jest.fn(() => [new SettingsEntity(mockSettings)]);
    const salesTaxCalc = jest.fn(() => ({ rate: 0 }));
    const mockFindOneCustomer = jest.fn(() => ({ data: [{ customerId: 'fake', invoices: [] }] }));
    const mockSumPaidAmountByInvoiceId = jest.fn(() => 123.45);
    const mockGetInvoicesForCustomer = jest.fn().mockResolvedValue([openedInvoice, paidInvoice]);
    const mockGetPoint = jest.fn(() => ({ tag: mockTag, stringField: jest.fn() }));
    const mockGetQueuedInvoices = jest.fn(() => [{ customerId: 'fake' }]);
    const mockGenerateCustomerTokenWithInvoiceId = jest.fn(() => ({ access_token: 'fake_token' }));
    const invoiceAPISpy = jest
        // eslint-disable-next-line
        // @ts-ignore
        .spyOn(InvoiceEntityFile.Invoice, 'invoiceAPI')
        // eslint-disable-next-line
        // @ts-ignore
        .mockImplementation(() => ({ data: 'test' }));
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
    };

    afterAll(() => {
        jest.restoreAllMocks();
    });
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                InvoicesService,
                {
                    provide: CustomerService,
                    useValue: {
                        findOne: mockFindOneCustomer,
                        findPayments: jest.fn(() => ({ data: [{ customerId: 'fake' }] })),
                        findRefunds: jest.fn(() => ({ data: [{ customerId: 'fake' }] })),
                    },
                },
                { provide: SettingsService, useValue: { findAll: mockSettingsFindOne } },
                { provide: TaxService, useValue: { calculateSalesTax: salesTaxCalc } },
                {
                    provide: PaymentService,
                    useValue: { getAmountPaid: mockSumPaidAmountByInvoiceId, publish: jest.fn() },
                },
                {
                    provide: InfluxService,
                    useValue: {
                        loadPoints: mockLoadPoints,
                        getPoint: mockGetPoint,
                        getSingleInvoice: getSingleInvoice,
                        getInvoicesForCustomer: mockGetInvoicesForCustomer,
                        getQueuedInvoicesForCustomer: mockGetQueuedInvoices,
                    },
                },
                {
                    provide: CreditService,
                    useValue: {
                        getCreditLedger: jest.fn(() => ({ data: [{ customerId: 'fake' }] })),
                    },
                },
                {
                    provide: LocalJWTAuthService,
                    useValue: {
                        generateCustomerTokenWithInvoiceId: mockGenerateCustomerTokenWithInvoiceId,
                    },
                },
            ],
            imports: [],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<InvoicesService>(InvoicesService);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });
    it('Should properly pass parameters to the Invoice API', async () => {
        await service.findOne('businessID', 'invoiceID', 'true');
        expect(getSingleInvoice).toHaveBeenCalledWith(
            expect.objectContaining({ businessID: 'businessID', invoiceId: 'invoiceID' }),
        );
        expect(mockSettingsFindOne).toHaveBeenCalledWith(expect.objectContaining({ businessID: 'businessID' }));
        expect(salesTaxCalc).toHaveBeenCalledTimes(0);
        expect(invoiceAPISpy).toHaveBeenCalledWith(
            expect.objectContaining({
                logoUrl: 'https://www.example.com/logo.png',
                tax: 0,
                currency: 'USD',
                dueDate: expect.anything(),
                invoiceNumber: 'fake',
                items: [],
                from: 'Test Business',
                to: 'Test Customer',
                paidAmount: 123.45,
            }),
        );
        expect(Upload).toHaveBeenCalledTimes(1);
        expect(mockGenerateCustomerTokenWithInvoiceId).toHaveBeenCalledTimes(0);
        expect(getSignedUrl).toHaveBeenCalledTimes(1);
        expect(mockFileCheck).toHaveBeenCalledTimes(1);
        expect(mockSumPaidAmountByInvoiceId).toHaveBeenCalledTimes(1);
    });

    it('Should keep addresses consistent', async () => {
        getSingleInvoice.mockImplementation(() => [
            {
                invoiceId: 'fake',
                businessID: 'myCoolCorp',
                _measurement: InvoiceEntityFile.Invoice._measurement,
                _time: new Date().toISOString(),
                currency: 'USD',
                invoiceLineItems: '[]',
                fromEntity: '123 Main St, Suite 1, San Francisco, CA, USA, 94105',
                toEntity: '111 South St, Suite 2, San Francisco, CA, USA, 94105',
                totalAmountWithoutTax: 150,
                taxAmount: 0,
            },
        ]);
        await service.findOne('businessID', 'invoiceID', 'true');

        expect(getSingleInvoice).toHaveBeenCalledWith(
            expect.objectContaining({ businessID: 'businessID', invoiceId: 'invoiceID' }),
        );
        expect(mockSettingsFindOne).toHaveBeenCalledWith(expect.objectContaining({ businessID: 'businessID' }));
        expect(invoiceAPISpy).toHaveBeenCalledWith(
            expect.objectContaining({
                from: '123 Main St, Suite 1, San Francisco, CA, USA, 94105',
                to: '111 South St, Suite 2, San Francisco, CA, USA, 94105',
                logoUrl: 'https://www.example.com/logo.png',
                tax: 0,
                currency: 'USD',
                dueDate: expect.anything(),
                invoiceNumber: 'fake',
                items: [],
            }),
        );
        expect(mockGenerateCustomerTokenWithInvoiceId).toHaveBeenCalledTimes(1);
    });

    it('return correct invoice belongs to specified customer', async () => {
        const businessID = 'some business id';
        const customerId = 'some customer id';

        const results = await service.findAll(businessID, customerId, true);

        expect(mockGetInvoicesForCustomer).toHaveBeenCalledWith({
            businessID,
            customerId,
            onlyOpenAndPaid: true,
        });
        expect(results).toHaveLength(2);
    });
    it('should queue invoices correctly', async () => {
        const businessID = 'some business id';
        const customerId = 'some customer id';
        await service.queueInvoice({
            customerId,
            businessID,
            items: [],
            invoiceDate: new Date().toISOString(),
            currency: SupportedCurrencies.USD,
        });
        expect(mockGetPoint).toHaveBeenCalledTimes(1);
        expect(mockGetPoint).toHaveBeenCalledWith(Invoice._queueMeasurement);

        expect(mockTag).toHaveBeenCalledTimes(10);
        expect(mockTag).toHaveBeenCalledWith('businessID', 'some business id');
        expect(mockTag).toHaveBeenCalledWith('invoiceId', expect.anything());

        expect(mockLoadPoints).toHaveBeenCalledTimes(1);
    });

    it('Should consolidate invoices correctly', async () => {
        const businessID = 'some business id';
        const customerId = 'some customer id';
        const mockLineItems = new InvoiceLineItems();
        mockLineItems.addLineItem(new InvoiceLineItem('foobar', 1, 1));
        await service.consolidateInvoice({
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
            businessID,
            customerId,
            invoiceDate: new Date().toISOString(),
            initalLineItems: mockLineItems,
        });
        expect(mockGetQueuedInvoices).toBeCalledTimes(1);
        expect(mockLoadPoints).toHaveBeenCalledTimes(1);
        expect(mockTag).toHaveBeenCalledTimes(14);
        expect(mockTag).toHaveBeenNthCalledWith(
            11,
            'invoiceLineItems',
            JSON.stringify([{ name: 'foobar', quantity: 1, unitCost: 1 }]),
        );
    });
});
