/* eslint-disable @typescript-eslint/no-var-requires */

const fetch = require('cross-fetch');
const { promises } = require('fs');

process.env.API_URL = 'http://localhost:3000';
process.env.STAGE = 'dev';
process.env.INTEGRATION_TEST_BUSINESS_ID = 'integrationTest';
process.env.INFLUX_URL = 'http://localhost:8086';

const MS_CONVERSION_FACTOR = 1000;
const TEN_SECONDS = 10000;
const {
    client_id,
    client_secret,
    admin_client_id,
    admin_client_secret,
    test_client_id,
    test_client_secret,
    influx_token,
    test_1_aws_account_id,
    test_1_aws_access_key_id,
    test_1_aws_secret_access_key,
    test_2_aws_account_id,
    test_2_aws_access_key_id,
    test_2_aws_secret_access_key,
    stripe_account_id,
    stripe_client_account_id,
    stripe_client_account_no_payout_id,
    kafka_client_id,
    kafka_client_secret,
    kafka_bootstrap_servers,
    kafka_topic,
    kafka_dlq_topic,
} = require('./secret.json');

process.env.TEST_1_ACCOUNT_ID = test_1_aws_account_id;
process.env.TEST_1_AWS_ACCESS_KEY_ID = test_1_aws_access_key_id;
process.env.TEST_1_AWS_SECRET_ACCESS_KEY = test_1_aws_secret_access_key;
process.env.TEST_2_ACCOUNT_ID = test_2_aws_account_id;
process.env.TEST_2_AWS_ACCESS_KEY_ID = test_2_aws_access_key_id;
process.env.TEST_2_AWS_SECRET_ACCESS_KEY = test_2_aws_secret_access_key;
process.env.STRIPE_ACCOUNT_ID = stripe_account_id;
process.env.STRIPE_CLIENT_ACCOUNT_ID = stripe_client_account_id;
process.env.STRIPE_CLIENT_ACCOUNT_ID_NO_PAYOUT = stripe_client_account_no_payout_id;
process.env.KAFKA_USERNAME = kafka_client_id;
process.env.KAFKA_PASSWORD = kafka_client_secret;
process.env.KAFKA_BOOTSTRAP_SERVER_ENDPOINT = kafka_bootstrap_servers;
process.env.KAFKA_TOPIC = kafka_topic;
process.env.KAFKA_DLQ_TOPIC = kafka_dlq_topic;
const getAndSetTokenAndUser = async () => {
    // Need to set this up and get it from another developer
    console.log('grabbing from auth0');
    const response = await fetch('https://auth.meteringco.example/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_id,
            client_secret,
            audience: 'https://example1234.execute-api.us-east-1.amazonaws.com',
            grant_type: 'client_credentials',
        }),
    });

    const { expires_in, access_token } = await response.json();

    const futureExpireTime = new Date(Date.now() + expires_in * MS_CONVERSION_FACTOR);

    const adminResponse = await fetch('https://auth.meteringco.example/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_id: admin_client_id,
            client_secret: admin_client_secret,
            audience: 'https://example1234.execute-api.us-east-1.amazonaws.com',
            grant_type: 'client_credentials',
            scope: 'admin:admin',
        }),
    });

    const res = await adminResponse.json();

    const adminExpires = new Date(Date.now() + res.expires_in * MS_CONVERSION_FACTOR);

    const testResponse = await fetch('https://auth.meteringco.example/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_id: test_client_id,
            client_secret: test_client_secret,
            audience: 'https://example1234.execute-api.us-east-1.amazonaws.com',
            grant_type: 'client_credentials',
        }),
    });

    const testRes = await testResponse.json();

    const testExpires = new Date(Date.now() + testRes.expires_in * MS_CONVERSION_FACTOR);
    await promises.writeFile(
        './integration/token_cache.json',
        JSON.stringify({
            access_token,
            expires_in: futureExpireTime,
            admin_token: res.access_token,
            admin_expires: adminExpires,
            test_token: testRes.access_token,
            test_expires: testExpires,
        })
    );
    process.env.API_ACCESS_TOKEN = access_token;
    process.env.ADMIN_ACCESS_TOKEN = res.access_token;
    process.env.TEST_ACCESS_TOKEN = testRes.access_token;
};
module.exports = async () => {
    try {
        // try to read file
        const cache = require('./token_cache.json');
        process.env.INFLUX_TOKEN = influx_token;
        // Only use the data in the cache if its not 10 seconds away from expiring
        const cacheDate = new Date(cache.expires_in);
        if (cache.access_token && cacheDate.getTime() > Date.now() + TEN_SECONDS) {
            process.env.API_ACCESS_TOKEN = cache.access_token;
            process.env.ADMIN_ACCESS_TOKEN = cache.admin_token;
            // await fetch(`${process.env.API_URL}/users`, {
            //     method: 'POST',
            //     headers: {
            //         Authorization: `Bearer ${process.env.API_ACCESS_TOKEN}`,
            //         'Content-Type': 'application/json',
            //     },
            //     body: JSON.stringify({
            //         subject: `${client_id}@clients`,
            //         businessID: process.env.INTEGRATION_TEST_BUSINESS_ID,
            //     }),
            // });
        } else {
            console.log('cache miss');
            await getAndSetTokenAndUser();
        }
    } catch (error) {
        console.log('Error', error);
    }
};
