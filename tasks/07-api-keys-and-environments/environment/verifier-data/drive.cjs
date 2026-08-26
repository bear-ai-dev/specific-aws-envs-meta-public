/*
 * Trusted driver.
 *
 * Starts the deliverable through its own entry point so that whatever that
 * entry point configures -- pipes, guards, request interceptors -- is in force,
 * and only redirects the listening port so a run cannot collide with anything
 * else on the box. Then it plays one console session against the running API:
 * a person signs in, looks at the credentials their account holds, moves
 * themselves between the two environments their account keeps, and rotates,
 * revokes and fails to touch a handful of specific credentials.
 *
 * Everything here loads code that belongs to the submission, so nothing it
 * prints or returns is a verdict. It writes down the status and body of every
 * exchange; what actually happened is read afterwards from the identity
 * provider and the configuration store, which the submission does not own.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const APP_DIR = process.env.APP_DIR || '/app';
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const PORT = Number(config.port);
const ENDPOINT = config.endpoint;
const BASE = `http://127.0.0.1:${PORT}`;

const exchanges = [];

function appRequire(relative) {
    return require(path.join(APP_DIR, relative));
}

async function mintToken(clientId, clientSecret) {
    const res = await fetch(`${ENDPOINT}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            audience: config.audience,
        }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.access_token || null;
}

async function call(label, token, method, route, body) {
    const started = Date.now();
    const record = { label, method, route };
    try {
        const res = await fetch(BASE + route, {
            method,
            headers: {
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                'content-type': 'application/json',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        record.status = res.status;
        const text = await res.text();
        record.body = text.slice(0, 20000);
        try {
            record.json = JSON.parse(text);
        } catch (error) {
            record.json = null;
        }
    } catch (error) {
        record.status = 0;
        record.error = String((error && error.message) || error);
    }
    record.ms = Date.now() - started;
    exchanges.push(record);
    return record;
}

async function boot() {
    // The application object handed back by the framework is a proxy, so the
    // port is redirected on the class instead: whatever port the entry point
    // asks for, this run listens on one that cannot collide.
    const nestApplication = appRequire('node_modules/@nestjs/core/nest-application.js');
    const prototype = nestApplication.NestApplication.prototype;
    const originalListen = prototype.listen;
    let captured = null;
    prototype.listen = function listenOnOurPort(_port, ...rest) {
        captured = this;
        return originalListen.call(this, PORT, ...rest);
    };

    // The entry point starts listening as a side effect of being loaded.
    appRequire('dist/genericExpressEnv.js');

    let lastError = 'never attempted';
    for (let attempt = 0; attempt < 240; attempt += 1) {
        if (captured) {
            try {
                const res = await fetch(BASE + '/', { method: 'GET' });
                if (res.status) return captured;
            } catch (error) {
                lastError = String((error && error.message) || error);
                if (error && error.cause) lastError += ` (${String(error.cause.message || error.cause)})`;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    console.error(`the deliverable never answered on ${BASE}: ${lastError}`);
    if (captured) {
        try {
            console.error(`listening on ${JSON.stringify(captured.getHttpServer().address())}`);
        } catch (error) {
            /* nothing to report */
        }
    }
    return null;
}

// A route that has nothing to do with the graded capability and is present in
// every starting tree. If the graded routes refuse while this one answers, the
// submission is being judged; if nothing answers at all, the run is.
async function reachable() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
            const res = await fetch(BASE + '/health', { method: 'GET' });
            if (res.status) return true;
        } catch (error) {
            /* retried below */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
}

async function main() {
    const app = await boot();
    if (!app) {
        fs.writeFileSync(config.out, JSON.stringify({ booted: false, reachable: false, exchanges }, null, 2));
        return;
    }

    const answering = await reachable();

    const operator = await mintToken(config.operator.clientId, config.operator.clientSecret);
    const viewer = await mintToken(config.viewer.clientId, config.viewer.clientSecret);
    const revoked = config.revokedKeyCredentials;
    const keyTokenBefore = await mintToken(revoked.clientId, revoked.clientSecret);

    // What the account holds where the operator currently is.
    await call('list.production', operator, 'GET', '/keys');

    // A credential that belongs to somebody else, and one the provider holds
    // that nobody has claimed: neither may be touched from here.
    await call('rotate.otherTenant', operator, 'PUT', `/keys/${config.targets.otherTenant}`);
    await call('revoke.unclaimed', operator, 'DELETE', `/keys/${config.targets.unclaimed}`);
    await call('rotate.retired', operator, 'PUT', `/keys/${config.targets.retired}`);

    // The same person moves to their other environment.
    await call('switch.sandbox', operator, 'PUT', '/users/environment', { environment: 'sandbox' });
    await call('list.sandbox', operator, 'GET', '/keys');

    // From there, the production credential is out of reach.
    await call('rotate.otherEnvironment', operator, 'PUT', `/keys/${config.targets.otherEnvironment}`);
    await call('revoke.otherEnvironment', operator, 'DELETE', `/keys/${config.targets.otherEnvironment}`);

    // A sign-in that may look but not change.
    await call('viewer.list', viewer, 'GET', '/keys');
    await call('viewer.rotate', viewer, 'PUT', `/keys/${config.targets.rotate}`);
    await call('viewer.revoke', viewer, 'DELETE', `/keys/${config.targets.revoke}`);

    // The credential the sandbox key itself carries still works at this point.
    await call('key.beforeRevocation', keyTokenBefore, 'GET', '/keys');

    // The two changes that are supposed to stick.
    await call('rotate.sandbox', operator, 'PUT', `/keys/${config.targets.rotate}`);
    await call('revoke.sandbox', operator, 'DELETE', `/keys/${config.targets.revoke}`);

    // Same bearer token as before, one revocation later.
    await call('key.afterRevocation', keyTokenBefore, 'GET', '/keys');

    await call('list.afterChanges', operator, 'GET', '/keys');

    // Back where they started, the production view must be untouched.
    await call('switch.production', operator, 'PUT', '/users/environment', { environment: 'production' });
    await call('list.productionAgain', operator, 'GET', '/keys');
    await call('environments', operator, 'GET', '/users/environment');

    fs.writeFileSync(
        config.out,
        JSON.stringify(
            {
                booted: true,
                reachable: answering,
                operatorTokenMinted: Boolean(operator),
                viewerTokenMinted: Boolean(viewer),
                keyTokenMinted: Boolean(keyTokenBefore),
                exchanges,
            },
            null,
            2,
        ),
    );

    try {
        await app.close();
    } catch (error) {
        /* the verdict does not depend on a clean shutdown */
    }
}

main().then(
    () => process.exit(0),
    (error) => {
        try {
            fs.writeFileSync(
                config.out,
                JSON.stringify(
                    { booted: false, reachable: false, fatal: String((error && error.stack) || error), exchanges },
                    null,
                    2,
                ),
            );
        } catch (writeError) {
            /* nothing further can be done */
        }
        process.exit(0);
    },
);
