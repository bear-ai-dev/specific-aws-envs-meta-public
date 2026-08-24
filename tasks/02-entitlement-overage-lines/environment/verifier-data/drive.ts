/*
 * Trusted driver. Runs inside the deliverable so module resolution matches the
 * project exactly, asks the invoice-line collector for one run per business, and
 * writes the raw lines out for scoring elsewhere.
 *
 * Nothing is stubbed: the catalogue and the metric readings the collector works
 * from are the account's, reached over the emulated endpoint by the submitted
 * code itself.
 *
 * Everything this file touches belongs to the submission, so nothing it prints
 * or returns is treated as a verdict: it only transports observations.
 */
import * as gathererModule from './src/microservices/invoiceLineGatherer/invoiceLineGatherer.service.js';
import { writeFileSync } from 'node:fs';

type Run = {
    label: string;
    businessID: string;
    catalogueBucket: string;
    catalogueKey: string;
};

const config = JSON.parse(process.argv[2]) as { runs: Run[]; out: string };

/** Whatever the module calls the collector, it is the export that can run it. */
function collectorClass(): any {
    const candidates = Object.values(gathererModule as Record<string, any>).filter(
        (exported) =>
            typeof exported === 'function' &&
            (typeof exported?.prototype?.gatherInvoiceLines === 'function' ||
                typeof exported?.prototype?.readOperationJob === 'function'),
    );
    if (candidates.length !== 1) {
        throw new Error(`expected exactly one invoice-line collector export, found ${candidates.length}`);
    }
    return candidates[0];
}

/** A line item, however the submission chose to hand it back. */
function normaliseLine(line: unknown): Record<string, unknown> {
    const entry = (line ?? {}) as Record<string, unknown>;
    return {
        name: entry.name,
        quantity: entry.quantity,
        unitCost: entry.unitCost,
    };
}

function linesOf(result: Record<string, unknown>): Array<Record<string, unknown>> {
    const candidates = [result.lineItems, result.lines, result.items];
    for (const candidate of candidates) {
        if (Array.isArray(candidate)) {
            return candidate.map(normaliseLine);
        }
        const holder = candidate as { getLineItems?: () => unknown } | undefined;
        if (holder && typeof holder.getLineItems === 'function') {
            const nested = holder.getLineItems();
            if (Array.isArray(nested)) {
                return nested.map(normaliseLine);
            }
        }
    }
    return [];
}

function normaliseResult(result: unknown): Record<string, unknown> {
    const entry = (result ?? {}) as Record<string, unknown>;
    return {
        customerId: entry.customerId,
        offeringId: entry.offeringId,
        offeringName: entry.offeringName,
        lineItems: linesOf(entry),
    };
}

async function main() {
    const runs: Record<string, unknown> = {};
    const Collector = collectorClass();

    for (const run of config.runs) {
        const parameters = {
            businessID: run.businessID,
            catalogueBucket: run.catalogueBucket,
            catalogueKey: run.catalogueKey,
        };
        const job = {
            data: {
                businessID: run.businessID,
                subject: 'verifier',
                rate: '0 6 1 * *',
                scheduleParameters: parameters,
            },
        };
        try {
            const collector = new Collector() as unknown as Record<string, unknown>;
            let returned: unknown;
            if (typeof collector.gatherInvoiceLines === 'function') {
                try {
                    returned = await (
                        collector.gatherInvoiceLines as (input: unknown) => Promise<unknown>
                    ).call(collector, parameters);
                } catch {
                    returned = undefined;
                }
            }
            if (!Array.isArray(returned) || !returned.length) {
                // The collector may only be reachable through the queue entry
                // point, or may want its parameters the way the queue sends
                // them. Either way what it assembles is observed.
                returned = await (collector.readOperationJob as (input: unknown) => Promise<unknown>).call(
                    collector,
                    job,
                );
            }
            const rows = Array.isArray(returned) ? returned : [];
            runs[run.label] = { ok: true, results: rows.map(normaliseResult) };
        } catch (error) {
            runs[run.label] = {
                ok: false,
                error: String((error as Error)?.message ?? error),
                stack: String((error as Error)?.stack ?? ''),
            };
        }
    }

    writeFileSync(config.out, JSON.stringify({ runs }, null, 2));
}

main().then(
    () => process.exit(0),
    (error) => {
        writeFileSync(config.out, JSON.stringify({ fatal: String(error?.stack ?? error) }, null, 2));
        process.exit(0);
    },
);
