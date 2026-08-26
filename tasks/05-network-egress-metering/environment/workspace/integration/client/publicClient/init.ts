export const API_BASE_URL = process.env.API_URL ? process.env.API_URL : 'http://localhost:3000';
export const MAX_RETRY = 3;
export const ACCESS_TOKEN = process.env.API_ACCESS_TOKEN
    ? process.env.API_ACCESS_TOKEN
    : require('../../token_cache.json').access_token;

export const ADMIN_ACCESS_TOKEN = process.env.ADMIN_ACCESS_TOKEN
    ? process.env.ADMIN_ACCESS_TOKEN
    : require('../../token_cache.json').admin_token;

export const TEST_ACCESS_TOKEN = process.env.TEST_ACCESS_TOKEN
    ? process.env.TEST_ACCESS_TOKEN
    : require('../../token_cache.json').test_token;
export const TEST_SUBJECT = '0BPskftWYAF5QeBth1fxQJeLQNuIDNMB@clients';

export class Address {
    countryCode: string;
    postalCode: string;
    state: string;
    city: string;
    streetLineOne: string;
    streetLineTwo: string;
    constructor(
        countryCode: string = '',
        postalCode: string = '',
        state: string = '',
        city: string = '',
        streetLineOne: string = '',
        streetLineTwo: string = ''
    ) {
        this.countryCode = countryCode;
        this.postalCode = postalCode;
        this.state = state;
        this.city = city;
        this.streetLineOne = streetLineOne;
        this.streetLineTwo = streetLineTwo;
    }
}
