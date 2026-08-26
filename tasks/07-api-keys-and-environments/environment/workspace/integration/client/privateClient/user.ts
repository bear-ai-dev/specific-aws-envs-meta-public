import { ADMIN_ACCESS_TOKEN, ACCESS_TOKEN, API_BASE_URL } from '../publicClient/init.js';
import fetch from 'cross-fetch';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/users';

export class User {
    static async create({ subject, businessID }): Promise<any> {
        const res = await fetch(API_BASE_URL + RESOURCE_PATH, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ADMIN_ACCESS_TOKEN}`,
            },
            body: JSON.stringify({
                subject,
                businessID,
            }),
        });
        if (res.status <= 201) {
            return await res.json();
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }

    static async get(token): Promise<any> {
        const res = await fetch(API_BASE_URL + RESOURCE_PATH, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
        });
        if (res.status <= 201) {
            return await res.json();
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }
    static async setSandBoxMode(isSandBoxMode: boolean) {
        const res = await fetch(API_BASE_URL + RESOURCE_PATH + '/environment', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${ACCESS_TOKEN}`,
            },
            body: JSON.stringify({ environment: isSandBoxMode ? 'sandbox' : 'production' }),
        });
        if (res.status <= 201) {
            return await res.json();
        } else {
            throw new Error(JSON.stringify(await res.json(), null, 2));
        }
    }
}
