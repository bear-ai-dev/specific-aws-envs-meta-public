/*
 * Trusted driver. Runs inside the deliverable so module resolution matches the
 * project exactly, hands the datastore intake one message per configured case,
 * and writes down only what the caller of the endpoint would have seen.
 *
 * What each call left in the object store is not read here. Root reads that
 * straight off the emulator once this process has exited, because everything
 * this file can touch belongs to the submission.
 */
import { PrivateAPIUsageController } from './src/usage/usage.controller.js';
import { readFileSync, writeFileSync } from 'node:fs';

type Case = {
    label: string;
    endpoint: 'db' | 'datastore';
    body: Record<string, unknown>;
    headers?: Record<string, string>;
};

const config = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { cases: Case[]; out: string };

// Stand-ins for the collaborators the controller is constructed with. The
// intake only ever reaches `usageService.create`, and only for a message it
// managed to load, so a message that gets that far is recorded here.
const loaded: unknown[] = [];
const usageService = {
    async create(input: unknown) {
        loaded.push(input);
        return { message: 'created', id: 'driver', data: [input] };
    },
    async findUsageForCustomer() {
        return [];
    },
};
const invoiceService = {
    async generateInvoiceGivenUsage() {
        return { message: 'invoiced', data: [] };
    },
};
const customerService = {
    async findOne() {
        return { message: 'ok', data: [{ enrollments: [] }] };
    },
};

function describe(error: unknown): Record<string, unknown> {
    const entry = (error ?? {}) as {
        name?: unknown;
        message?: unknown;
        status?: unknown;
        constructor?: { name?: unknown };
        getStatus?: () => unknown;
    };
    let status: unknown = entry.status;
    if (status === undefined && typeof entry.getStatus === 'function') {
        try {
            status = entry.getStatus();
        } catch {
            status = undefined;
        }
    }
    return {
        name: typeof entry.name === 'string' ? entry.name : undefined,
        className: typeof entry.constructor?.name === 'string' ? entry.constructor.name : undefined,
        status: typeof status === 'number' ? status : undefined,
        message: typeof entry.message === 'string' ? entry.message.slice(0, 400) : undefined,
    };
}

async function main() {
    const results: Record<string, unknown> = {};
    const controller = new PrivateAPIUsageController(
        usageService as never,
        invoiceService as never,
        customerService as never,
    );
    const intake = controller as unknown as {
        dbUsage?: (body: unknown) => Promise<unknown>;
        datastoreUsage?: (body: unknown, request: unknown) => Promise<unknown>;
    };

    for (const entry of config.cases) {
        const before = loaded.length;
        try {
            if (entry.endpoint === 'db') {
                if (typeof intake.dbUsage !== 'function') {
                    results[entry.label] = { threw: false, absent: true };
                    continue;
                }
                await intake.dbUsage(entry.body);
            } else {
                if (typeof intake.datastoreUsage !== 'function') {
                    results[entry.label] = { threw: false, absent: true };
                    continue;
                }
                await intake.datastoreUsage(entry.body, { headers: entry.headers ?? {} });
            }
            results[entry.label] = { threw: false, loaded: loaded.length > before };
        } catch (error) {
            results[entry.label] = { threw: true, loaded: loaded.length > before, error: describe(error) };
        }
    }

    writeFileSync(config.out, JSON.stringify({ cases: results }, null, 2));
}

main().then(
    () => process.exit(0),
    (error) => {
        writeFileSync(
            config.out,
            JSON.stringify({ fatal: String((error as Error)?.stack ?? error) }, null, 2),
        );
        process.exit(0);
    },
);
