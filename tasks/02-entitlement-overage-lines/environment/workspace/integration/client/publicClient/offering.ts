import { ACCESS_TOKEN, API_BASE_URL, MAX_RETRY } from './init.js';
import fetch from 'cross-fetch';
import { sleep } from '../../utils/utils.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/offerings';

export enum OfferingType {
    UsageBased = 'usage-based',
    Subscription = 'subscription',
}

export abstract class Offering {
    offeringType: OfferingType | null;
    offeringName: string | null;
    dimensionIds?: string[] | null;
    offeringId?: string | null;
    subscriptionPrice: number | null;
    currency?: string;
    freeTrialLength?: string;

    protected constructor(
        offeringId: string | null = null,
        type: OfferingType | null = null,
        name: string | null = null,
        dimensionIds: string[] | null = null,
        subscriptionPrice: number | null = null,
        currency?: string,
        freeTrialLength?: string
    ) {
        this.offeringType = type;
        this.offeringName = name;
        this.dimensionIds = dimensionIds;
        this.offeringId = offeringId;
        this.subscriptionPrice = subscriptionPrice;
        this.currency = currency;
        this.freeTrialLength = freeTrialLength;
    }

    abstract create(payload: {}): Promise<void>;

    protected async createOffering(payload: {
        offeringType;
        offeringName;
        dimensionIds?;
        subscriptionPrice?;
        currency?: string;
    }) {
        return await this.writeOffering(payload, 'POST', API_BASE_URL + RESOURCE_PATH);
    }

    protected async updateOffering(payload: { offeringName?; dimensionIds?; subscriptionPrice? }) {
        return await this.writeOffering(payload, 'PUT', API_BASE_URL + RESOURCE_PATH + '/' + `${this.offeringId}`);
    }

    private async writeOffering(
        payload: { offeringType?; offeringName?; dimensionIds?; subscriptionPrice?; currency?: string },
        method: string = 'POST',
        url: string = API_BASE_URL + RESOURCE_PATH
    ): Promise<any> {
        const { offeringType, offeringName, dimensionIds, subscriptionPrice, ...rest } = payload;
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    offeringType,
                    offeringName,
                    dimensionIds,
                    subscriptionPrice: subscriptionPrice?.toString(),
                    ...rest,
                }),
            });
            if (res.status <= 201) {
                this.offeringName = offeringName;
                this.offeringType = offeringType;
                this.dimensionIds = dimensionIds;
                this.offeringId = (await res.json()).offeringId;
                this.subscriptionPrice = Number(subscriptionPrice);
                this.currency = rest?.currency;
                return this.offeringId;
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }

    async update(updatedFields): Promise<any> {
        const res = await fetch(API_BASE_URL + RESOURCE_PATH + '/' + `${this.offeringId}`, {
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
            this.offeringId = jsonRes?.offeringId;
            return this.offeringId;
        } else {
            const jsonRes = await res.json();
            throw new Error(JSON.stringify(jsonRes, null, 2));
        }
    }

    async delete(): Promise<any> {
        if (!this.offeringId) {
            throw new Error('Offering not initialized');
        }
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.offeringId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                this.offeringId = null;
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
    static async getById(offeringId?: string): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${offeringId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                return (await res.json()).data[0];
            } else if (retries === MAX_RETRY - 1) {
                throw await res.json();
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }

    async get(): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.offeringId}`, {
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
}

export class UsageBasedOffering extends Offering {
    constructor(
        offeringId: string | null = null,
        name: string | null = null,
        dimensionIds: string[] | null = null,
        freeTrialLength?: string
    ) {
        super(offeringId, OfferingType.UsageBased, name, dimensionIds, null, freeTrialLength);
    }

    async create(payload: { offeringName; dimensionIds?: Array<string> } | { [key: string]: string }): Promise<void> {
        const { offeringName, dimensionIds, ...rest } = payload;
        return this.createOffering({
            offeringType: OfferingType.UsageBased,
            offeringName,
            dimensionIds,
            ...rest,
        });
    }
}

export class SubscriptionOffering extends Offering {
    subscriptionPrice: number;

    constructor(
        offeringId: string | null = null,
        name: string | null = null,
        subscriptionPrice: number | null = null,
        freeTrialLength?: string
    ) {
        super(offeringId, OfferingType.Subscription, name, null, subscriptionPrice, freeTrialLength);
    }

    async create(payload: {
        offeringName?: string;
        dimensionIds?: Array<string>;
        subscriptionPrice?: number | string;
        freeTrialLength?: string;
        prepaidCredit?: string;
    }): Promise<void> {
        const { offeringName, dimensionIds, subscriptionPrice, ...rest } = payload;
        return this.createOffering({
            offeringType: OfferingType.Subscription,
            offeringName,
            dimensionIds,
            subscriptionPrice,
            ...rest,
        });
    }
}
