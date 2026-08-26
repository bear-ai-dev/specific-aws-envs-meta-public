/**
 * Trusted driver. Runs as the agent, loads the submission, and records what it
 * published. Its exit status means nothing: the reward comes from the document
 * it writes, scored by a root process that loads none of this.
 *
 * The submission chooses its own names, so nothing here is hard-coded to a path
 * or a class. What it looks for is code the submission wrote: a file that is new
 * or changed against the tree the box started with, exporting a class with a
 * queue handler on it. Failing that, a handler-shaped method on such a class.
 * The usage it publishes is captured at the platform's own usage-recording
 * entry point, which is the one part of the path the submission did not write.
 */

import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { pathToFileURL } from 'url';

const BULL_PROCESS_KEYS = ['bull:module_queue_process', 'BULL_MODULE_QUEUE_PROCESS'];
const RUN_TIMEOUT_MS = 240_000;
const MAX_CANDIDATES = 8;
const PUBLISH_MODULE = 'src/measurement-config/entities/standardMeasurement.entity.js';

type RunSpec = {
    label: string;
    businessID: string;
    dimensionId: string;
    region: string;
    iamRoleArn: string;
    externalId?: string;
};

type Config = {
    runs: RunSpec[];
    out: string;
    baseline: string;
    appRoot?: string;
};

type Row = { customerId?: unknown; dimensionId?: unknown; recordValue?: unknown };

type Candidate = {
    file: string;
    className: string;
    method: string;
    jobKind: string | null;
    rank: number;
    make: () => unknown;
};

const config: Config = JSON.parse(process.argv[2] ?? '{}');
const APP_ROOT = config.appRoot ?? process.cwd();
const SRC_ROOT = join(APP_ROOT, 'src');
const observed: { runs: Record<string, unknown>; discovery?: unknown } = { runs: {} };

function persist(): void {
    writeFileSync(config.out, `${JSON.stringify(observed, null, 2)}\n`, 'utf8');
}

function note(message: string): void {
    process.stdout.write(`${message}\n`);
}

// ---------------------------------------------------------------------------
// which files the submission wrote
// ---------------------------------------------------------------------------

function walk(root: string): string[] {
    const found: string[] = [];
    const visit = (dir: string): void => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            if (entry === 'node_modules' || entry.startsWith('.')) continue;
            const full = join(dir, entry);
            let info;
            try {
                info = statSync(full);
            } catch {
                continue;
            }
            if (info.isDirectory()) visit(full);
            else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) found.push(full);
        }
    };
    visit(root);
    return found.sort();
}

function digest(path: string): string {
    return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function authoredFiles(): string[] {
    let baseline: Record<string, string> = {};
    try {
        baseline = JSON.parse(readFileSync(config.baseline, 'utf8')).files ?? {};
    } catch {
        note('no baseline manifest; treating every source file as a candidate');
    }
    const authored: string[] = [];
    for (const file of walk(SRC_ROOT)) {
        const key = relative(APP_ROOT, file).split(sep).join('/');
        const known = baseline[key];
        if (known === undefined || known !== digest(file)) authored.push(file);
    }
    return authored;
}

// ---------------------------------------------------------------------------
// which of them is the collector
// ---------------------------------------------------------------------------

function processMetadata(target: unknown): string | null {
    const reflect = (Reflect as unknown as { getMetadata?: (k: string, t: unknown) => unknown }).getMetadata;
    if (typeof reflect !== 'function' || typeof target !== 'function') return null;
    for (const key of BULL_PROCESS_KEYS) {
        let found: unknown;
        try {
            found = reflect(key, target);
        } catch {
            continue;
        }
        if (found === undefined || found === null) continue;
        if (typeof found === 'string') return found;
        const name = (found as { name?: unknown }).name;
        return typeof name === 'string' ? name : '';
    }
    return null;
}

function methodsOf(prototype: object): string[] {
    return Object.getOwnPropertyNames(prototype).filter((name) => {
        if (name === 'constructor') return false;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        return typeof descriptor?.value === 'function';
    });
}

async function candidatesIn(file: string): Promise<Candidate[]> {
    let module: Record<string, unknown>;
    try {
        module = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    } catch (error) {
        note(`could not load ${relative(APP_ROOT, file)}: ${(error as Error).message}`);
        return [];
    }

    const found: Candidate[] = [];
    for (const [exportName, exported] of Object.entries(module)) {
        if (typeof exported !== 'function' || !exported.prototype) continue;
        const prototype = exported.prototype as object;
        const make = (): unknown => {
            try {
                return new (exported as new () => unknown)();
            } catch {
                return Object.create(prototype);
            }
        };
        for (const method of methodsOf(prototype)) {
            // A queue consumer in this codebase also carries a failure hook,
            // which is not the collector and takes a different argument.
            if (/fail|error|dlq/i.test(method)) continue;
            const implementation = (prototype as Record<string, unknown>)[method] as (...args: unknown[]) => unknown;
            if (implementation.length < 1) continue;
            const kind = processMetadata(implementation);
            let rank = 1;
            if (kind !== null) rank = 4;
            else if (method === 'readOperationJob') rank = 3;
            else if (/^(collect|meter|measure|gather|run|process|handle|execute|read|main)/i.test(method)) rank = 2;
            found.push({
                file: relative(APP_ROOT, file),
                className: exportName,
                method,
                jobKind: kind,
                rank,
                make,
            });
        }
    }
    return found;
}

async function findCollectors(): Promise<Candidate[]> {
    const files = authoredFiles();
    note(`files the submission wrote or changed: ${files.length}`);
    const all: Candidate[] = [];
    for (const file of files) all.push(...(await candidatesIn(file)));
    all.sort((a, b) => b.rank - a.rank || a.file.localeCompare(b.file) || a.method.localeCompare(b.method));
    observed.discovery = {
        authored: files.map((file) => relative(APP_ROOT, file)),
        candidates: all.map(({ file, className, method, jobKind, rank }) => ({
            file,
            className,
            method,
            jobKind,
            rank,
        })),
    };
    for (const candidate of all) {
        note(`candidate: ${candidate.className}.${candidate.method} in ${candidate.file} (rank ${candidate.rank})`);
    }
    return all.slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// running one collection
// ---------------------------------------------------------------------------

function rowsFrom(value: unknown): Row[] {
    if (!Array.isArray(value)) return [];
    return value.filter(
        (entry): entry is Row =>
            typeof entry === 'object' && entry !== null && 'customerId' in entry && 'recordValue' in entry,
    );
}

async function main(): Promise<void> {
    persist();

    const candidates = await findCollectors();
    const runs = config.runs ?? [];
    if (!candidates.length) {
        for (const run of runs) {
            observed.runs[run.label] = { ok: false, error: 'no collector was found in the submission' };
        }
        persist();
        note('no collector found');
        return;
    }

    const publishModule = (await import(pathToFileURL(join(APP_ROOT, PUBLISH_MODULE)).href)) as {
        StandardMeasurementEntity: { publish: (row: unknown) => unknown };
    };
    const entity = publishModule.StandardMeasurementEntity;
    const original = entity.publish.bind(entity);
    let captured: Row[] = [];
    entity.publish = (row: unknown): unknown => {
        if (row && typeof row === 'object') captured.push(row as Row);
        return original(row);
    };

    const attempt = async (collector: Candidate, run: RunSpec): Promise<{ rows: Row[]; error: string | null }> => {
        captured = [];
        const parameters: Record<string, unknown> = {
            iamRoleArn: run.iamRoleArn,
            externalId: run.externalId,
            dimensionId: run.dimensionId,
            region: run.region,
        };
        if (collector.jobKind) parameters.dimensionType = collector.jobKind;
        const job = {
            id: `verify-${run.label}`,
            name: collector.jobKind ?? run.label,
            attemptsMade: 0,
            timestamp: Date.now(),
            data: {
                schedulerID: `sched-${run.label}`,
                businessID: run.businessID,
                subject: run.businessID,
                rate: '*/5 * * * *',
                schedulerStatus: 'live',
                scheduleParameters: parameters,
            },
        };

        let returned: unknown;
        let error: string | null = null;
        try {
            const instance = collector.make() as Record<string, (job: unknown) => unknown>;
            returned = await Promise.race([
                Promise.resolve(instance[collector.method](job)),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('the collection did not finish in time')), RUN_TIMEOUT_MS),
                ),
            ]);
        } catch (thrown) {
            error = thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown);
        }
        // Publishing is the usual path; a collector that hands its rows back
        // instead is taken at its word rather than failed on a technicality.
        return { rows: captured.length ? captured : rowsFrom(returned), error };
    };

    // Ranking is a guess, so the first run is used to settle it: whichever
    // candidate actually produces usage is the collector, and the rest were
    // helpers that happened to look the part.
    let chosen: Candidate | null = null;
    let firstOutcome: { rows: Row[]; error: string | null } | null = null;
    for (const candidate of candidates) {
        const outcome = await attempt(candidate, runs[0]);
        note(
            `${candidate.className}.${candidate.method}: ${outcome.rows.length} row(s)` +
                `${outcome.error ? ` after ${outcome.error}` : ''}`,
        );
        if (firstOutcome === null || (!firstOutcome.rows.length && outcome.rows.length)) {
            chosen = candidate;
            firstOutcome = outcome;
        }
        if (outcome.rows.length) break;
    }

    note(`driving ${chosen!.className}.${chosen!.method} from ${chosen!.file}`);
    observed.discovery = { ...(observed.discovery as object), chosen: `${chosen!.className}.${chosen!.method}` };
    for (const [index, run] of runs.entries()) {
        const outcome = index === 0 ? firstOutcome! : await attempt(chosen!, run);
        observed.runs[run.label] =
            outcome.error && !outcome.rows.length
                ? { ok: false, error: outcome.error }
                : { ok: true, rows: outcome.rows, error: outcome.error };
        note(`[${run.label}] ${outcome.rows.length} row(s)${outcome.error ? ` after ${outcome.error}` : ''}`);
        persist();
    }

    entity.publish = original;
    persist();
}

// The observation document is written synchronously, so leaving is safe as soon
// as it is on disk. Submitted code is free to hold open sockets, timers and
// loggers, and waiting for it to drain them is not the verifier's business.
main()
    .catch((error) => {
        observed.runs.__driver = { ok: false, error: `${error}` };
        persist();
        note(`driver failed: ${error}`);
    })
    .finally(() => process.exit(0));
