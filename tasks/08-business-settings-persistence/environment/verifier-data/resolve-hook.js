/*
 * The project's sources address each other with the extension their compiled
 * output carries. Running them straight from source means a relative request
 * ending in .js has to be allowed to land on the .ts file sitting next to it.
 */
const Module = require('module');
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function (request, ...rest) {
    if (typeof request === 'string' && request.startsWith('.') && request.endsWith('.js')) {
        try {
            return originalResolve.call(this, request.slice(0, -3) + '.ts', ...rest);
        } catch {
            /* falls through to the request as written */
        }
    }
    return originalResolve.call(this, request, ...rest);
};
