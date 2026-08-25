import { ACCESS_TOKEN, Address, API_BASE_URL, MAX_RETRY } from './init.js';
import fetch from 'cross-fetch';
import { sleep } from '../../utils/utils.js';
import { Offering } from './offering.js';
import { DatetimeUtils } from '../../utils/Datetime.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/customers';

export enum TaxExempt {
    Exempt = 'exempt',
    None = 'none',
}

export enum PaymentChannel {
    Stripe = 'Stripe',
    Manual = 'manual',
}

export class Customer {
    customerName: string;
    email: string;
    taxExempt: TaxExempt;
    customerId: string;
    address: Address | null;
    paymentChannel: PaymentChannel | null;
    paymentChannelOptions: { stripeCustomerId: string } | null;
    customerVatId: string;
    offering: Offering | undefined | null;
    customerAccessToken: string | undefined | null;
    freeTrialEndDate?: string;
    currency?: string;
    invoices: any[];
    portalUrl: string;
    stripeAccountReady: boolean;
    constructor(
        id: string = '',
        name: string = '',
        email: string = '',
        taxExempt: TaxExempt = TaxExempt.None,
        address: Address | null = null,
        paymentChannel: PaymentChannel | null = null,
        paymentChannelOptions: { stripeCustomerId: string } | null = null,
        Offering: Offering | undefined | null = null,
        customerAccessToken?: string | undefined | null,
        freeTrialEndDate?: string
    ) {
        this.customerName = name;
        this.email = email;
        this.taxExempt = taxExempt;
        this.customerId = id;
        this.address = address;
        this.paymentChannel = paymentChannel;
        this.paymentChannelOptions = paymentChannelOptions;
        this.offering = Offering;
        this.customerAccessToken = customerAccessToken;
        this.freeTrialEndDate = freeTrialEndDate;
    }

    async create({
        customerName,
        email,
        taxExempt,
        address,
        paymentChannel,
        paymentChannelOptions,
        customerVatId,
        offeringId,
        currency,
        offeringEnrollmentDate = DatetimeUtils.lastYearGivenDate(new Date()).toISOString(),
    }): Promise<any> {
        const body = {
            customerName,
            email,
            taxExempt,
            address,
            paymentChannel,
            paymentChannelOptions,
            customerVatId,
            offeringId,
            currency,
            offeringEnrollmentDate: offeringId ? offeringEnrollmentDate : undefined,
        };
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify(body),
            });
            if (res.status <= 201) {
                const jsonRes = await res.json();
                this.customerName = customerName;
                this.email = email;
                this.taxExempt = taxExempt;
                this.customerId = jsonRes?.customerId;
                this.portalUrl = jsonRes?.portalUrl;
                this.address = address;
                this.paymentChannel = paymentChannel;
                this.paymentChannelOptions = paymentChannelOptions;
                this.customerVatId = customerVatId;
                this.currency = currency;
                return this.customerId;
            } else if (retries === MAX_RETRY - 1) {
                throw await res.json();
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
    async update(updatedFields): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH + '/' + `${this.customerId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify(updatedFields),
            });
            if (res.status <= 201) {
                const jsonRes = await res.json();
                Object.keys(updatedFields).forEach((updatedFieldKey) => {
                    this[updatedFieldKey] = updatedFields[updatedFieldKey];
                });
                this.customerId = jsonRes?.customerId;
                this.portalUrl = jsonRes?.portalUrl;
                return this.customerId;
            } else if (retries === MAX_RETRY - 1) {
                throw await res.json();
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
    async delete(): Promise<any> {
        if (!this.customerId) {
            throw new Error('Customer not initialized');
        }
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.customerId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                this.customerId = null;
                Object.keys(this).forEach((key) => {
                    this[key] = null;
                });
                return;
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
    async get(): Promise<any | Customer> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.customerId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                return (await res.json()).data[0];
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }

    async getAll(): Promise<any> {
        const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            return (await res.json()).data;
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }
    async getUsage(startTime, endTime, aggregationInterval, aggregationPurpose?: string): Promise<any> {
        if (!this.customerId) {
            throw new Error('Customer is not initialized yet');
        }
        const url = `${API_BASE_URL}${RESOURCE_PATH}/${
            this.customerId
        }/usage?startTime=${startTime}&endTime=${endTime}&aggregationInterval=${aggregationInterval}&aggregationPurpose=${
            aggregationPurpose || 'billing'
        }`;
        console.log(url, 'url');
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            return (await res.json()).data;
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }

    async getJWT(): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.customerId}/token`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                const JSONres = await res.json();
                this.customerAccessToken = JSONres?.access_token;
                return JSONres?.access_token;
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }

    async getSaaScustomerUsage(): Promise<any> {
        if (!this.customerId) {
            throw new Error('Customer is not initialized yet');
        }
        const url = `${API_BASE_URL}/portal/customer/usage`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.customerAccessToken}`,
            },
        });
        if (res.status <= 201) {
            return await res.json();
        } else {
            throw await res.json();
        }
    }

    async setTransactionCredit(creditAmount): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH + `/${this.customerId}/transactions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({ transactionAmount: creditAmount }),
            });
            if (res.status <= 201) {
                const jsonRes = await res.json();

                return jsonRes;
            } else if (retries === MAX_RETRY - 1) {
                throw await res.json();
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }

    async getPortalurl(): Promise<any> {
        if (!this.customerId) {
            throw new Error('Customer is not initialized yet');
        }
        const url = `${API_BASE_URL}${RESOURCE_PATH}/${this.customerId}/stripePortal`;
        const res = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            return await res.json();
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }
}
