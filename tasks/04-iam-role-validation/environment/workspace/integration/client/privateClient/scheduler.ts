import { ACCESS_TOKEN, API_BASE_URL, MAX_RETRY } from '../publicClient/init.js';
import fetch from 'cross-fetch';
import { sleep } from '../../utils/utils.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/scheduler';

export class Scheduler {
    public schedulerStatus?: string;
    public schedulerType?: string;
    public scheduleParameters?: any;
    public dimensionType?: string;
    public billingDate?: string;
    constructor(scheduler: Scheduler = {} as Scheduler) {
        Object.keys(scheduler).forEach((schedulerKey) => {
            this[schedulerKey] = scheduler[schedulerKey];
        });
    }

    static async update(data: Scheduler): Promise<any> {
        throw new Error('Method not implemented.');
    }

    static async get(id): Promise<any> {
        const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${id}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            return (await res.json()).data;
        } else {
            throw await res.json();
        }
    }

    static async getAll(): Promise<any> {
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
    static async delete(id: string): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH + '/' + id, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status === 400) {
                return res.json();
            }
            if (res.status <= 201) {
                return res.json();
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
    static async pushSingleJobToQueue(data: Scheduler): Promise<any> {
        const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/emit`, {
            method: 'POST',
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
        });
        if (res.status <= 201) {
            return res.json();
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }
}
