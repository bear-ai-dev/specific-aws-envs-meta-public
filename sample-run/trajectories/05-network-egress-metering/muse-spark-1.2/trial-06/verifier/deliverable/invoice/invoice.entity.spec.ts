import { paymentChannel } from '../customer/dto/create-customer.dto.js';
import { InvoiceApproval } from '../setting/dto/InvoiceApproval.js';
import { TaxService } from '../tax/tax.service.js';
import { Invoice, InvoiceLineItem, InvoiceLineItems } from './entities/invoice.entity.js';
import { InvoiceStatus } from './entities/InvoiceStatus.js';

describe('Invoice Entity', () => {
    it('Should prepare Addresses correctly', () => {
        const invoice = new Invoice({ customerId: '123', businessID: 'business', invoiceId: '123' });
        invoice.loadPropertiesFromCustomerEntity({
            customerId: '123',
            businessID: 'business',
            customerName: 'Test Customer',
            email: 'test@meteringco.example',
            address: {
                streetLineOne: '123 Main St',
                streetLineTwo: 'Apt 1',
                countryCode: 'us',
                city: 'New York',
                state: 'NY',
                postalCode: '12345',
            },
            paymentChannel: paymentChannel.manual,
            offering: {
                offeringName: 'Test Offering',
                offeringId: '123',
                dimensions: [],
            },
        });
        invoice.loadPropertiesFromSettingsEntity({
            addressLine1: '123 Main Ave',
            addressLine2: 'Apt 1000',
            city: 'San Francisco',
            state: 'CA',
            country: 'us',
            postalCode: '94105',
        });
        const { fromEntity, toEntity } = invoice.prepareAddressesForInvoice();
        expect(fromEntity).toContain('123 Main Ave');
        expect(fromEntity).toContain('Apt 1000');
        expect(fromEntity).toContain('San Francisco');
        expect(fromEntity).toContain('CA');
        expect(fromEntity).toContain('United States of America');
        expect(fromEntity).toContain('94105');
        expect(toEntity).toContain('123 Main St');
        expect(toEntity).toContain('Apt 1');
        expect(toEntity).toContain('New York');
        expect(toEntity).toContain('NY');
        expect(toEntity).toContain('United States of America');
        expect(toEntity).toContain('12345');
        expect(toEntity).toContain('test@meteringco.example');
    });
    it('Should register tax only if address information is complete for customer', async () => {
        const invoice = new Invoice({ customerId: '123', businessID: 'business', invoiceId: '123' });
        invoice.loadPropertiesFromCustomerEntity({
            customerId: '123',
            businessID: 'business',
            customerName: 'Test Customer',
            email: 'test@meteringco.example',
            address: {
                streetLineOne: '123 Main St',
                streetLineTwo: 'Apt 1',
                countryCode: 'us',
                city: 'New York',
                state: 'NY',
                postalCode: '12345',
            },
            paymentChannel: paymentChannel.manual,
            offering: {
                offeringName: 'Test Offering',
                offeringId: '123',
                dimensions: [],
            },
        });
        const mockTaxService = {
            registerTransaction: jest.fn(),
        } as unknown as TaxService;
        await invoice.registerInvoiceTaxTransaction({ taxTransactionId: '123', taxService: mockTaxService });
        expect(mockTaxService.registerTransaction).toBeCalledTimes(1);
    });
    it('Should not register tax for incomplete address', async () => {
        const invoice = new Invoice({ customerId: '123', businessID: 'business', invoiceId: '123' });
        invoice.loadPropertiesFromCustomerEntity({
            customerId: '123',
            businessID: 'business',
            customerName: 'Test Customer',
            email: 'test@meteringco.example',
            paymentChannel: paymentChannel.manual,
            offering: {
                offeringName: 'Test Offering',
                offeringId: '123',
                dimensions: [],
            },
        });
        const mockTaxService = {
            registerTransaction: jest.fn(),
        } as unknown as TaxService;
        await invoice.registerInvoiceTaxTransaction({ taxTransactionId: '123', taxService: mockTaxService });
        expect(mockTaxService.registerTransaction).toBeCalledTimes(0);
    });

    it('should move the invoice to open status if settings are set correctly', async () => {
        const invoice = new Invoice({ customerId: '123', businessID: 'business', invoiceId: '123' });
        invoice.saveToDB = jest.fn();

        invoice.loadPropertiesFromCustomerEntity({
            customerId: '123',
            businessID: 'business',
            customerName: 'Test Customer',
            email: 'test@meteringco.example',
            address: {
                streetLineOne: '123 Main St',
                streetLineTwo: 'Apt 1',
                countryCode: 'us',
                city: 'New York',
                state: 'NY',
                postalCode: '12345',
            },
            paymentChannel: paymentChannel.manual,
            offering: {
                offeringName: 'Test Offering',
                offeringId: '123',
                dimensions: [],
            },
        });
        invoice.loadPropertiesFromSettingsEntity({ invoiceApproval: InvoiceApproval.automatic });
        const mockTaxService = {
            registerTransaction: jest.fn(),
        } as unknown as TaxService;
        await invoice.generate(mockTaxService, false);
        expect(invoice.invoiceStatus).toBe(InvoiceStatus.OPEN);
        expect(invoice.saveToDB).toBeCalledTimes(2);
    });
    test.each([
        [[{ quantity: 10, unitCost: 0.0000000001, name: 'low price under 0.00' }], 0],
        [[{ quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' }], 0.01],
        [
            [
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
            ],
            0.02,
        ],
        [
            [
                { quantity: 100000000, unitCost: 0.00000123456, name: 'higher total odd unitcost' },
                { quantity: 100000000, unitCost: 0.0000099999, name: 'higher total' },
            ],
            1123.45,
        ],
        [
            [
                { quantity: 1, unitCost: 123.888899874, name: 'low quantity, pricecise unitCost' },
                { quantity: 2, unitCost: 10, name: 'integer quantity and unitCost' },
            ],
            143.89,
        ],
        [
            [
                { quantity: 0, unitCost: 123.888899874, name: '0 quantity' },
                { quantity: 2, unitCost: 10, name: 'integer quantity and unitCost' },
            ],
            20,
        ],
        [
            [
                { quantity: 1000000, unitCost: 0.000016, name: 'realistic example' },
                { quantity: 1, unitCost: 20, name: 'subscription fee' },
            ],
            36,
        ],
        [
            [
                { quantity: 1000000, unitCost: 0.000016, name: 'realistic example' },
                { quantity: 1, unitCost: 20, name: 'subscription fee' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
                { quantity: 100000000, unitCost: 0.0000000001, name: 'higher quantity over 0.01' },
            ],
            36.12,
        ],
    ])('High Precision calculations', (inputArray, expected) => {
        const invoiceLineItems = new InvoiceLineItems();
        inputArray.forEach(({ quantity, unitCost, name }) =>
            invoiceLineItems.addLineItem(new InvoiceLineItem(name, quantity, unitCost)),
        );

        const invoice = new Invoice({
            customerId: '123',
            businessID: 'business',
            invoiceId: '123',
            invoiceLineItems: invoiceLineItems,
        });
        expect(invoice.totalAmountWithoutTax).toEqual(expected);
    });
});
