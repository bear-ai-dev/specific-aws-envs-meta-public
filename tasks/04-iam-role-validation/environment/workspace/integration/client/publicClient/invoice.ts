import { sleep } from '../../utils/utils.js';
import fetch from 'cross-fetch';
import { ACCESS_TOKEN, API_BASE_URL, MAX_RETRY } from './init.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/invoices';

export enum InvoiceStatus {
    DRAFT = 'Draft',
    OPEN = 'Open',
    PAID = 'Paid',
    VOIDED = 'Voided',
}

export class InvoiceLineItem {
    name: string;
    quantity: number;
    unitCost: number;
    description?: string;

    constructor(name: string, quantity: number, unitCost: number, description?: string) {
        this.name = name;
        this.quantity = quantity;
        this.unitCost = unitCost;
        this.description = description;
    }
}

export class InvoiceLineItems {
    lineItems: InvoiceLineItem[] = [];

    addLineItem(lineItem: InvoiceLineItem) {
        this.lineItems.push(lineItem);
    }
}
export class Invoice {
    invoiceId: string;
    invoiceStatus: string;
    invoiceS3bucket: string;
    invoiceS3key: string;
    invoiceDate: string;
    customerId: string;
    totalAmountWithoutTax: number;
    taxAmount: number;
    invoiceUrl: string;
    lineItems: any;
    invoicePaymentTerm: any;
    currency: string;

    constructor(invoice: Invoice = {} as Invoice) {
        Object.keys(invoice).forEach((invoiceKey) => {
            this[invoiceKey] = invoice[invoiceKey];
        });
    }

    static async update(data): Promise<string> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH + `/${data.invoiceId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    ...data,
                }),
            });
            if (res.status <= 201) {
                const { message } = await res.json();

                return message;
            } else if (retries === MAX_RETRY - 1) {
                const { message } = await res.json();
                return message;
            } else {
                console.log(JSON.stringify(await res.json(), null, 2));
                await sleep(1000 * (retries + 1));
            }
        }
        throw new Error('Failed to update invoice, check logs');
    }

    static async delete(): Promise<any> {
        throw new Error('Method not implemented.');
    }

    static async get(invoiceId: string, download: 'true' | 'false' = 'false'): Promise<any> {
        const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${invoiceId}?download=${download}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            return new Invoice((await res.json())?.data[0]);
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }

    static async getAll(): Promise<Invoice | any> {
        throw new Error('Method not implemented.');
    }

    static async generateOffcycleInvoice({
        customerId,
        start,
        end,
        invoicePaymentTerm,
        invoiceDate,
        download,
    }: {
        customerId: string;
        start?: Date;
        end?: Date;
        invoicePaymentTerm?: string;
        invoiceDate?: Date;
        download?: 'true' | 'false';
    }) {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    customerId,
                    start: start?.toISOString(),
                    end: end?.toISOString(),
                    invoicePaymentTerm,
                    invoiceDate: invoiceDate?.toISOString(),
                }),
            });
            if (res.status <= 201) {
                const { invoiceId } = await res.json();
                await sleep(2 * 1000);
                return Invoice.get(invoiceId, download);
            } else if (retries === MAX_RETRY - 1) {
                return res.json();
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
}
