/* eslint-disable @typescript-eslint/no-var-requires */

const fetch = require('cross-fetch');
const { promises } = require('fs');
process.env.API_URL = 'https://api.qa.meteringco.example';

const getAndSetToken = async () => {
    console.log('grabbing from auth0');
    const response = await fetch('https://auth.meteringco.example/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
            audience: 'https://example1234.execute-api.us-east-1.amazonaws.com',
            grant_type: 'client_credentials',
        }),
    });

    const { access_token } = await response.json();
    // TODO: Set token in github and retrieve from there
    process.env.API_ACCESS_TOKEN = access_token;
    const adminResponse = await fetch('https://auth.meteringco.example/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_id: process.env.ADMIN_CLIENT_ID,
            client_secret: process.env.ADMIN_CLIENT_SECRET,
            audience: 'https://example1234.execute-api.us-east-1.amazonaws.com',
            grant_type: 'client_credentials',
            scope: 'admin:admin',
        }),
    });

    const res = await adminResponse.json();

    const testResponse = await fetch('https://auth.meteringco.example/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            client_id: process.env.TEST_CLIENT_ID,
            client_secret: process.env.TEST_CLIENT_SECRET,
            audience: 'https://example1234.execute-api.us-east-1.amazonaws.com',
            grant_type: 'client_credentials',
        }),
    });

    const testRes = await testResponse.json();

    process.env.API_ACCESS_TOKEN = access_token;
    process.env.ADMIN_ACCESS_TOKEN = res.access_token;
    process.env.TEST_ACCESS_TOKEN = testRes.access_token;

    await promises.writeFile(
        './integration/token_cache.json',
        JSON.stringify({
            access_token,
            expires_in: 0,
        })
    );

    await promises.writeFile(
        './integration/secret.json',
        JSON.stringify({
            client_id: process.env.CLIENT_ID,
            client_secret: process.env.CLIENT_SECRET,
        })
    );
};
module.exports = async () => {
    try {
        await getAndSetToken();
    } catch (error) {
        console.log('Error', error);
    }
};
