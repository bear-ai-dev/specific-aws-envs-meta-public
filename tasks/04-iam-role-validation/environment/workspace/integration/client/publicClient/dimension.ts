import { ACCESS_TOKEN, Address, API_BASE_URL, MAX_RETRY } from './init.js';
import fetch from 'cross-fetch';
import { sleep } from '../../utils/utils.js';

/*
 * Private, don't EXPORT to avoid name conflicts.
 * All operations for this resource should be encapsulated in this class.
 */
const RESOURCE_PATH = '/dimensions';

export enum AggregationInterval {
    None = 'none',
    Hour = 'hour',
    Day = 'day',
}
export enum aggregationIntervalInMS {
    none = 0,
    hour = 3600000,
    day = 86400000,
    month = 2592000000,
}
export enum AggregationMethod {
    Average = 'average',
    Sum = 'sum',
    Min = 'min',
    Max = 'max',
    Count = 'count',
}

export enum OverageAllowed {
    True = 'true',
    False = 'false',
}

export enum Rounding {
    Floor = 'floor',
    Ceiling = 'ceiling',
    Round = 'round',
}

export class Dimension {
    aggregationInterval: AggregationInterval;
    aggregationMethod: AggregationMethod;
    dimensionName: string;
    consumptionPrice: string;
    overageAllowed: OverageAllowed;
    UsageEntitlement: string;
    rounding: Rounding;
    usageIncrement: string;
    dimensionId: string;
    consumptionUnit: Object;
    measurementId?: string;
    constructor(
        id: string = null,
        aggregationInterval: AggregationInterval = null,
        aggregationMethod: AggregationMethod = null,
        name: string = null,
        consumptionPrice: string = null,
        overageAllowed: OverageAllowed = null,
        usageEntitlement: string = null,
        rounding: Rounding = null,
        usageIncrement: string = null,
        consumptionUnit: Object = null,
        measurementId: string = null
    ) {
        this.aggregationInterval = aggregationInterval;
        this.aggregationMethod = aggregationMethod;
        this.dimensionName = name;
        this.consumptionPrice = consumptionPrice;
        this.overageAllowed = overageAllowed;
        this.UsageEntitlement = usageEntitlement;
        this.rounding = rounding;
        this.usageIncrement = usageIncrement;
        this.dimensionId = id;
        this.consumptionUnit = consumptionUnit;
        this.measurementId = measurementId;
    }
    async create({
        aggregationInterval,
        aggregationMethod,
        name,
        consumptionPrice = undefined,
        overageAllowed,
        usageEntitlement,
        rounding,
        usageIncrement,
        consumptionUnit,
        measurementId = undefined,
    }: {
        [x: string]: any;
        consumptionPrice?: string | undefined | null;
    }): Promise<any> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(API_BASE_URL + RESOURCE_PATH, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
                body: JSON.stringify({
                    aggregationInterval,
                    aggregationMethod,
                    dimensionName: name,
                    consumptionPrice,
                    overageAllowed,
                    usageEntitlement,
                    rounding,
                    usageIncrement,
                    consumptionUnit,
                    measurementId,
                }),
            });
            if (res.status <= 201) {
                this.aggregationInterval = aggregationInterval;
                this.aggregationMethod = aggregationMethod;
                this.dimensionName = name;
                this.consumptionPrice = consumptionPrice;
                this.overageAllowed = overageAllowed;
                this.UsageEntitlement = usageEntitlement;
                this.rounding = rounding;
                this.usageIncrement = usageIncrement;
                this.dimensionId = (await res.json()).dimensionId;
                this.consumptionUnit = consumptionUnit;
                this.measurementId = measurementId;
                return this.dimensionId;
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
        if (!this.dimensionId) {
            throw new Error('Dimension not initialized');
        }
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${this.dimensionId}`, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status <= 201) {
                this.dimensionId = null;
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
    static async getByDimensionId(dimensionId): Promise<any | Response> {
        for (let retries = 0; retries < MAX_RETRY; retries++) {
            const res = await fetch(`${API_BASE_URL}${RESOURCE_PATH}/${dimensionId}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${ACCESS_TOKEN}`,
                },
            });
            if (res.status === 404) {
                return res;
            }
            if (res.status <= 201) {
                return (await res.json()).data;
            } else if (retries === MAX_RETRY - 1) {
                throw new Error(JSON.stringify(await res.json(), null, 2));
            } else {
                await sleep(1000 * (retries + 1));
            }
        }
    }
}
