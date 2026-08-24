import { ACCESS_TOKEN, API_BASE_URL, MAX_RETRY } from '../publicClient/init.js';
import fetch from 'cross-fetch';
import { sleep } from '../../utils/utils.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/analytics';

export type AnalyticsQueryParamters = {
    start?: string;
    end?: string;
    customerId?: string;
    metric?: string;
};

export class Analytics {
    constructor(scheduler: Analytics = {} as Analytics) {
        Object.keys(scheduler).forEach((schedulerKey) => {
            this[schedulerKey] = scheduler[schedulerKey];
        });
    }

    static async update(data: Analytics): Promise<any> {
        throw new Error('Method not implemented.');
    }

    static async get(): Promise<any> {
        throw new Error('Method not implemented.');
    }

    static async getAll(parameters: AnalyticsQueryParamters): Promise<any> {
        const parameterKeys = Object.keys(parameters);
        const query = parameterKeys.reduce((acc, key, index) => {
            if (index === 0) {
                return acc + `?${key}=${parameters[key]}`;
            } else {
                return acc + `&${key}=${parameters[key]}`;
            }
        }, '');
        const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}${query}`, {
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
    static async delete(id: string): Promise<any> {
        throw new Error('Method not implemented.');
    }
}
