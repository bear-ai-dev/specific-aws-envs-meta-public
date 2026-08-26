/*
 * Makes the tenant's identity host resolve to the local endpoint.
 *
 * The deployment addresses its identity provider by its public name, which has
 * no meaning inside a box with no outbound network. This preload rewrites
 * requests for that host onto the endpoint the rest of the world is served
 * from, for both the HTTP core modules and the global fetch, so any client
 * library reaches the same place. Nothing else about a request is altered:
 * method, path, query, headers and body are passed through untouched.
 *
 * Loaded through NODE_OPTIONS, so it applies to every Node process in the box.
 */
'use strict';

const http = require('http');
const https = require('https');

const IDENTITY_HOST = 'auth.meteringco.example';
const LOCAL_HOST = process.env.IDENTITY_PROVIDER_HOST || '127.0.0.1';
const LOCAL_PORT = Number(process.env.IDENTITY_PROVIDER_PORT || process.env.MOCKAWS_PORT || 4566);

function isIdentityHost(value) {
    if (!value) return false;
    return String(value).split(':')[0].toLowerCase() === IDENTITY_HOST;
}

function redirectOptions(options) {
    const next = Object.assign({}, options);
    next.protocol = 'http:';
    next.hostname = LOCAL_HOST;
    next.host = `${LOCAL_HOST}:${LOCAL_PORT}`;
    next.port = LOCAL_PORT;
    next.servername = undefined;
    next.agent = undefined;
    if (next.headers) {
        next.headers = Object.assign({}, next.headers, { host: IDENTITY_HOST });
    } else {
        next.headers = { host: IDENTITY_HOST };
    }
    return next;
}

function normalise(input, options) {
    // The core modules accept (url), (url, options) and (options); only the
    // shapes that name the identity host need touching.
    if (typeof input === 'string' || input instanceof URL) {
        const url = new URL(String(input));
        if (!isIdentityHost(url.hostname)) return null;
        const merged = Object.assign({}, options, {
            path: `${url.pathname}${url.search}`,
            method: (options && options.method) || 'GET',
        });
        return redirectOptions(merged);
    }
    if (input && typeof input === 'object' && (isIdentityHost(input.hostname) || isIdentityHost(input.host))) {
        return redirectOptions(input);
    }
    return null;
}

function patch(module_, name) {
    const original = module_[name].bind(module_);
    module_[name] = function patched(...args) {
        const [input, second, third] = args;
        const callback = typeof second === 'function' ? second : third;
        const options = typeof second === 'function' ? undefined : second;
        const redirected = normalise(input, options);
        if (!redirected) {
            // Anything not addressed to the identity host is passed through
            // with its arguments exactly as they were given: the core modules
            // distinguish (options, cb) from (url, options, cb) by shape.
            return original(...args);
        }
        return callback ? http[name](redirected, callback) : http[name](redirected);
    };
}

patch(https, 'request');
patch(https, 'get');
patch(http, 'request');
patch(http, 'get');

if (typeof globalThis.fetch === 'function') {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = function fetchThroughLocalIdentity(resource, init) {
        try {
            const href = typeof resource === 'string' ? resource : resource && resource.url;
            if (href) {
                const url = new URL(href);
                if (isIdentityHost(url.hostname)) {
                    url.protocol = 'http:';
                    url.hostname = LOCAL_HOST;
                    url.port = String(LOCAL_PORT);
                    if (typeof resource === 'string') {
                        return originalFetch(url.toString(), init);
                    }
                    return originalFetch(new Request(url.toString(), resource), init);
                }
            }
        } catch (error) {
            // A resource this preload cannot parse is not one it should divert.
        }
        return originalFetch(resource, init);
    };
}
