import { ACCESS_TOKEN, Address, API_BASE_URL, MAX_RETRY } from './init.js';
import fetch from 'cross-fetch';
import { sleep } from '../../utils/utils.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/usage';

export class Usage {
    constructor() {}
    async create({
        timestamp = new Date().toISOString(),
        customerId,
        dimensionId,
        recordValue,
        metadata = {},
    }): Promise<void> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    timestamp: timestamp,
                    customerId,
                    dimensionId,
                    recordValue,
                    metadata,
                }),
            });
            if (res.status <= 201) {
                return await res.json();
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
}
