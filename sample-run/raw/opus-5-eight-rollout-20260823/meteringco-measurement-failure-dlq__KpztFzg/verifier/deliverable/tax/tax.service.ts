import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import Taxjar from 'taxjar';
import { Invoice, InvoiceLineItem } from '../invoice/entities/invoice.entity.js';
import { SettingsService } from '../setting/settings.service.js';

import { AccountState } from '../setting/entities/AccountState.js';
import { Address } from '../customer/dto/create-customer.dto.js';
import { serializeError } from 'serialize-error';

export class TaxableLineItem {
    quantity: number;
    product_tax_code: string;
    unit_price: number;
    discount?: number;
    constructor(quantity: number, productTaxCode: string, unitPrice: number, discount?: number) {
        this.quantity = quantity;
        this.product_tax_code = productTaxCode;
        this.unit_price = unitPrice;
        this.discount = discount;
    }
    static fromInvoiceLineItem(productTaxCode: string, invoiceLineItem: InvoiceLineItem): TaxableLineItem {
        return new TaxableLineItem(invoiceLineItem.quantity, productTaxCode, invoiceLineItem.unitCost);
    }
}

export class TaxableLineItems {
    private lineItems: TaxableLineItem[] = [];
    addLineItem(lineItem: TaxableLineItem) {
        this.lineItems.push(lineItem);
    }
    getLineItems() {
        return this.lineItems;
    }
}

@Injectable()
export class TaxService {
    private static logger = new Logger(TaxService.name);
    constructor(@Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService) {}

    /**
     * @param fromCountry
     * @param fromZip
     * @param fromState
     * @param fromCity
     * @param fromStreet
     * @param toCountry
     * @param toZip
     * @param toState
     * @param toCity
     * @param toStreet
     * @param lineItems
     */
    async calculateSalesTax(
        fromCountry: string,
        fromZip: string,
        fromState: string,
        fromCity: string,
        fromStreet: string,
        toCountry: string,
        toZip: string,
        toState: string,
        toCity: string,
        toStreet: string,
        lineItems: TaxableLineItems,
        businessID: string,
    ): Promise<{ rate: number; amountToCollect: number; error?: { message: string } }> {
        const [{ taxJarApiKey, accountState }] = await this.settingsService.findAll({ businessID });
        if (!taxJarApiKey) {
            throw new BadRequestException('TaxJar API Key is not set');
        }
        const taxjarClient = new Taxjar({
            apiKey: taxJarApiKey,
            apiUrl: accountState === AccountState.production ? process.env.PROD_TAX_JAR_URL : process.env.TAX_JAR_URL,
        });
        try {
            const taxInfo = await taxjarClient.taxForOrder({
                from_country: fromCountry,
                from_zip: fromZip,
                from_state: fromState,
                from_city: fromCity,
                from_street: fromStreet,
                to_country: toCountry,
                to_zip: toZip,
                to_state: toState,
                to_city: toCity,
                to_street: toStreet,
                shipping: 0,
                line_items: lineItems.getLineItems(),
            });
            const { rate, amount_to_collect: amountToCollect } = taxInfo.tax;
            return { rate, amountToCollect };
        } catch (error) {
            if (error instanceof Taxjar.Error && error.status === 400) {
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Improper Tax Address formation',
                    data: [{ errorStack: error.stack, errorStatus: error.status, errorMessage: error.message }],
                });
                return { rate: 0, amountToCollect: 0, error: { message: error.message } };
            } else {
                throw error;
            }
        }
    }

    async registerTransaction({
        businessID,
        transactionId,
        lineItems,
        amount,
        salesTax,
        address,
        transactionDate,
    }: {
        businessID: string;
        transactionId: string;
        lineItems: TaxableLineItem[];
        amount: number;
        salesTax: number;
        address: Address;
        transactionDate?: string;
    }) {
        TaxService.logger.debug(`Registering transaction ${transactionId} with TaxJar`);
        const [{ taxJarApiKey, accountState }] = await this.settingsService.findAll({ businessID });
        if (!taxJarApiKey) {
            return;
        }
        const taxjarClient = new Taxjar({
            apiKey: taxJarApiKey,
            apiUrl: accountState === AccountState.production ? process.env.PROD_TAX_JAR_URL : process.env.TAX_JAR_URL,
        });
        try {
            const taxInfo = await taxjarClient.createOrder({
                transaction_id: transactionId,
                transaction_date: transactionDate || new Date().toISOString(),
                provider: 'meteringco',
                to_country: address.countryCode,
                to_zip: address.postalCode,
                to_state: address.state,
                to_city: address.city,
                to_street: address.streetLineTwo
                    ? `${address.streetLineOne} ${address.streetLineTwo}`
                    : address.streetLineOne,
                amount: amount,
                shipping: 0,
                sales_tax: salesTax,
                line_items: lineItems,
            });
            TaxService.logger.debug(`Registered transaction ${transactionId} with TaxJar`);
            try {
                TaxService.logger.debug(JSON.stringify(taxInfo));
            } catch (e) {
                TaxService.logger.debug(`Couldn't stringify taxInfo`);
                TaxService.logger.debug(e);
                TaxService.logger.debug(taxInfo);
            }
            return taxInfo;
        } catch (error) {
            TaxService.logger.error("Couldn't register transaction with TaxJar");
            TaxService.logger.error(serializeError(error));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: "Couldn't register transaction with TaxJar",
                data: [
                    {
                        errorStack: error?.stack,
                        errorStatus: error?.status,
                        errorMessage: error?.message,
                        error: serializeError(error),
                    },
                ],
            });
        }
    }
}
