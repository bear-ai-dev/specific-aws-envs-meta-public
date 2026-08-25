import { ACCESS_TOKEN, API_BASE_URL, MAX_RETRY } from './init.js';
import fetch from 'cross-fetch';
import { sleep } from '../../utils/utils.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/services';

export class Service {
    serviceName: string;
    serviceId: string;
    offeringId: string;
    customerId: string;
    applicationId?: string;
    constructor(
        name: string = null,
        id: string = null,
        offeringId: string = null,
        customerId: string = null,
        applicationId: string = null
    ) {
        this.serviceName = name;
        this.serviceId = id;
        this.offeringId = offeringId;
        this.customerId = customerId;
        this.applicationId = applicationId;
    }

    async create({ name, offeringId, customerId, applicationId = null }): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    serviceName: name,
                    offeringId,
                    customerId,
                    applicationId,
                }),
            });
            if (res.status <= 201) {
                this.serviceName = name;
                this.serviceId = (await res.json()).serviceId;
                this.offeringId = offeringId;
                this.customerId = customerId;
                this.applicationId = applicationId;
                return this.serviceId;
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
    async update(): Promise<any> {
        throw new Error('Method not implemented.');
    }
    async delete(): Promise<any> {
        if (!this.serviceId) {
            throw new Error('Service not initialized');
        }
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.serviceId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                this.serviceId = null;
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
    async get(): Promise<any> {
        throw new Error('Method not implemented.');
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

    async getUsage(startTime, endTime, aggregationInterval): Promise<any> {
        if (!this.serviceId) {
            throw new Error('Service is not initialized yet');
        }
        const url = `${API_BASE_URL}${RESOURCE_PATH}/${this.serviceId}/usage?startTime=${startTime}&endTime=${endTime}&aggregationInterval=${aggregationInterval}`;
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
}
