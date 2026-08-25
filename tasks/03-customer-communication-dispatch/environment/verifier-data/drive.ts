/*
 * Trusted driver. Runs inside the deliverable so module resolution matches the
 * project exactly, publishes customer communications onto the bus the backend
 * publishes them onto, and waits for the process to go quiet.
 *
 * It transports nothing of substance: the graded artefact is the outbox the
 * emulated endpoint wrote, which this process cannot reach except to count its
 * lines while deciding whether the run has finished. Whatever it prints or
 * writes is a diagnostic, never a verdict.
 *
 * The submission may attach its dispatcher to the bus in any of the ways the
 * project already attaches one:
 *
 *   - as a side effect of importing something under src/customer/,
 *   - from a module lifecycle hook on a class exported by customer.module.ts,
 *   - from a method on CustomerService,
 *
 * and if none of those has left a listener on the channel, the driver finds the
 * dispatcher itself and subscribes it, so a submission that wrote the processor
 * but wired it somewhere this driver cannot reach is still exercised.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Email = Record<string, unknown>;
type Event = { message: string; topic: string; data: Email[] };
type Config = { events: Event[]; out: string; outbox: string; appRoot?: string };

const config = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Config;
const TOPIC = 'EMAIL';
const notes: string[] = [];

// A dispatcher that lets a send reject is answering the question badly, not
// crashing the harness. Nothing below may take the run down with it.
process.on('unhandledRejection', (reason) => {
    notes.push(`unhandled rejection: ${String((reason as Error)?.message ?? reason).slice(0, 200)}`);
});
process.on('uncaughtException', (error) => {
    notes.push(`uncaught exception: ${String(error?.message ?? error).slice(0, 200)}`);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function outboxLines(): number {
    try {
        const text = readFileSync(config.outbox, 'utf8');
        return text.split('\n').filter((line) => line.trim().length > 0).length;
    } catch {
        return 0;
    }
}

/* ---- finding the bus and whatever is listening to it -------------------- */

function emitterOf(bus: unknown): { listenerCount(name: string): number } | undefined {
    const candidate = bus as Record<string, unknown>;
    if (candidate && typeof (candidate as { listenerCount?: unknown }).listenerCount === 'function') {
        return candidate as { listenerCount(name: string): number };
    }
    for (const value of Object.values(candidate ?? {})) {
        const inner = value as { listenerCount?: unknown };
        if (inner && typeof inner.listenerCount === 'function') {
            return inner as { listenerCount(name: string): number };
        }
    }
    return undefined;
}

function wired(bus: unknown): boolean {
    try {
        return (emitterOf(bus)?.listenerCount(TOPIC) ?? 0) > 0;
    } catch {
        return false;
    }
}

function sourceFiles(root: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        let entries: string[];
        try {
            entries = readdirSync(dir);
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = join(dir, entry);
            let info;
            try {
                info = statSync(full);
            } catch {
                continue;
            }
            if (info.isDirectory()) {
                walk(full);
            } else if (/\.ts$/.test(entry) && !/\.(spec|test|d)\.ts$/.test(entry)) {
                out.push(full);
            }
        }
    };
    walk(root);
    return out.sort();
}

async function importAll(files: string[]): Promise<Record<string, unknown>[]> {
    const loaded: Record<string, unknown>[] = [];
    for (const file of files) {
        try {
            loaded.push((await import(file)) as Record<string, unknown>);
        } catch (error) {
            notes.push(`import skipped ${file}: ${String((error as Error)?.message).slice(0, 120)}`);
        }
    }
    return loaded;
}

function runLifecycleHooks(namespaces: Record<string, unknown>[]): void {
    for (const namespace of namespaces) {
        for (const exported of Object.values(namespace ?? {})) {
            const cls = exported as { prototype?: Record<string, unknown> };
            if (typeof exported !== 'function' || !cls.prototype) continue;
            if (typeof cls.prototype.onModuleInit !== 'function') continue;
            try {
                const instance = new (exported as new () => { onModuleInit(): unknown })();
                instance.onModuleInit();
            } catch (error) {
                notes.push(`lifecycle hook skipped: ${String((error as Error)?.message).slice(0, 120)}`);
            }
        }
    }
}

function runSubscribeMethods(service: unknown): void {
    const targets: unknown[] = [service];
    const cls = service as { prototype?: unknown };
    if (typeof service === 'function' && cls.prototype) {
        try {
            targets.push(new (service as new () => unknown)());
        } catch {
            /* a service that needs its dependencies is not a wiring route */
        }
    }
    for (const target of targets) {
        const holder = target as Record<string, unknown>;
        const names = new Set<string>();
        for (const name of Object.getOwnPropertyNames(holder ?? {})) names.add(name);
        const proto = Object.getPrototypeOf(holder ?? {});
        if (proto) for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
        for (const name of names) {
            if (!/subscribe|register|wire/i.test(name) || name === 'constructor') continue;
            const method = (holder as Record<string, unknown>)[name];
            if (typeof method !== 'function' || method.length > 0) continue;
            try {
                (method as () => unknown).call(holder);
            } catch (error) {
                notes.push(`subscribe method ${name} skipped: ${String((error as Error)?.message).slice(0, 120)}`);
            }
        }
    }
}

function findProcessor(namespaces: Record<string, unknown>[]): unknown {
    const candidates: { name: string; value: unknown }[] = [];
    for (const namespace of namespaces) {
        for (const [name, exported] of Object.entries(namespace ?? {})) {
            if (name === 'CustomerCommunicationEntity') continue;
            const cls = exported as { prototype?: Record<string, unknown> };
            if (typeof exported === 'function' && cls.prototype && typeof cls.prototype.process === 'function') {
                try {
                    candidates.push({ name, value: new (exported as new () => unknown)() });
                } catch {
                    /* needs constructor arguments; not something to guess at */
                }
            } else if (exported && typeof (exported as { process?: unknown }).process === 'function') {
                candidates.push({ name, value: exported });
            }
        }
    }
    if (!candidates.length) return undefined;
    const preferred = candidates.find(({ name }) => /mail|communicat|dispatch|notif/i.test(name));
    return (preferred ?? candidates[0]).value;
}

/* ---- the run ------------------------------------------------------------ */

async function main() {
    const diagnostics: Record<string, unknown> = { published: 0, notes };

    const appRoot = config.appRoot ?? '/app';
    const serviceModule = (await import(`${appRoot}/src/customer/customer.service.js`)) as Record<string, unknown>;
    const service = serviceModule.CustomerService as Record<string, unknown> | undefined;
    const bus = service?.customerCommunicationSystem as { publish(request: Event): unknown } | undefined;
    if (!bus || typeof bus.publish !== 'function') {
        diagnostics.fatal = 'the customer communication system is not reachable from CustomerService';
        writeFileSync(config.out, JSON.stringify(diagnostics, null, 2));
        return;
    }

    const namespaces = await importAll(sourceFiles(`${appRoot}/src/customer`));
    namespaces.push(serviceModule);

    if (!wired(bus)) runLifecycleHooks(namespaces);
    if (!wired(bus) && service) runSubscribeMethods(service);
    if (!wired(bus)) {
        const processor = findProcessor(namespaces);
        const subscribe = (bus as unknown as { subscribe?: (topic: string, processor: unknown) => void }).subscribe;
        if (processor && typeof subscribe === 'function') {
            try {
                subscribe.call(bus, TOPIC, processor);
                diagnostics.wiring = 'driver subscribed the dispatcher it found';
            } catch (error) {
                notes.push(`subscribe failed: ${String((error as Error)?.message).slice(0, 200)}`);
            }
        } else {
            diagnostics.wiring = 'nothing on this tree looks like a dispatcher';
        }
    } else {
        diagnostics.wiring = 'the submission wired the channel itself';
    }

    for (const event of config.events) {
        const before = outboxLines();
        try {
            bus.publish(event);
            diagnostics.published = (diagnostics.published as number) + 1;
        } catch (error) {
            notes.push(`publish threw: ${String((error as Error)?.message).slice(0, 200)}`);
        }
        // Publishing is fire and forget, so the run is finished when the
        // endpoint stops being written to, not when publish returns.
        const started = Date.now();
        let seen = before;
        let changed = Date.now();
        while (Date.now() - started < 20000) {
            await sleep(100);
            const now = outboxLines();
            if (now !== seen) {
                seen = now;
                changed = Date.now();
            }
            if (Date.now() - changed >= 2000) break;
        }
    }

    await sleep(1000);
    diagnostics.outboxLines = outboxLines();
    writeFileSync(config.out, JSON.stringify(diagnostics, null, 2));
}

main().then(
    () => process.exit(0),
    (error) => {
        writeFileSync(
            config.out,
            JSON.stringify({ fatal: String((error as Error)?.stack ?? error), notes }, null, 2),
        );
        process.exit(0);
    },
);
