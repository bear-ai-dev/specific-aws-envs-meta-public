/*
 * Trusted driver. Runs inside the deliverable so module resolution matches the
 * project exactly, and submits API-call traffic through the service entry
 * points the request path and the scheduler use.
 *
 * Everything this file touches belongs to the submission, so nothing it prints
 * or returns is treated as a verdict: it only transports observations. What
 * decides the grade is the state of the time-series store, which the verifier
 * reads off the emulator over a channel this process cannot reach.
 *
 * Collaborators are supplied rather than resolved through Nest, because the
 * application module graph pulls in queues and brokers that have nothing to do
 * with metering. The store client is the real one, pointed at the emulator, so
 * every registration really is written and every window really is read back.
 * Collaborators are attached by name rather than by constructor position, so a
 * submission that wires them in a different order, or calls them something
 * else, is not penalised for it.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { InfluxService } from './src/influx/influx.service.js';
import { TokenConsumerService } from './src/token-consumer/token-consumer.service.js';
import { TokenConsumerAsyncProcessor } from './src/token-consumer/token-consumer-async-processor.js';
import { UsageService } from './src/usage/usage.service.js';
import { StandardMeasurementEntity } from './src/measurement-config/entities/standardMeasurement.entity.js';
import { cache } from './src/cacheStore.js';

type Step = {
    label: string;
    op: string;
    call?: string;
    customer?: string;
    tenant?: string;
    atOffset?: number;
    startOffset?: number;
    endOffset?: number;
};

type Spec = {
    tenant: string;
    subject: string;
    platformCustomer: string;
    otherPlatformCustomer: string;
    platformBusiness: string;
    otherPlatformBusiness: string;
    aggregateBucket: string;
    usageBucket: string;
    amount: number;
    calls: Record<string, string>;
    preexistingMethods: Record<string, string[]>;
    tenantMeasurement: { customerId: string; dimensionId: string; recordValue: string };
    steps: Step[];
};

const config = JSON.parse(readFileSync(process.argv[2], 'utf8')) as { spec: Spec; out: string; base: string };
const spec = config.spec;
const baseMs = Date.parse(config.base);

const OTHER_TENANT = 'harborline-staging';

const INFLUX_ALIASES = ['influxService', 'influx', 'InfluxService', 'influxDBService'];
const TOKEN_SERVICE_ALIASES = ['tokenConsumerService', 'tokenService', 'tokenConsumer'];
const SCHEDULER_ALIASES = ['schedulerService'];
const ENVIRONMENT_ALIASES = ['environmentSerivce', 'environmentService'];
const JWT_ALIASES = ['localJWTAuthService', 'jwtAuthService'];

/* Conventional names first, then anything the submission added. The workspace's
 * own method list travels in the spec so a surviving neighbour is never
 * mistaken for the entry point under test. */
const REGISTER_NAMES = [
    'queueToken', 'registerToken', 'register', 'enqueueToken', 'enqueue', 'queue',
    'meterToken', 'meter', 'recordToken', 'recordApiCall', 'trackToken', 'addToken',
];
const AGGREGATE_NAMES = [
    'aggregateTokens', 'aggregateToken', 'aggregate', 'aggregateUsage', 'rollupTokens',
    'rollUpTokens', 'processAggregation', 'aggregateApiCalls', 'sumTokens',
];

function attach(target: Record<string, any>, aliases: string[], value: unknown): void {
    for (const alias of aliases) {
        target[alias] = value;
    }
}

function describeError(error: unknown): Record<string, unknown> {
    const err = (error ?? {}) as Record<string, any>;
    return {
        name: String(err.name ?? typeof error),
        message: String(err.message ?? error),
        // Diagnostic only. The reward never reads it; it is here so a run that
        // failed for a harness reason can be told apart from one that failed on
        // its merits.
        stack: String(err.stack ?? '').split('\n').slice(0, 6).join('\n'),
    };
}

function ownMethods(ctor: any): string[] {
    const found = new Set<string>();
    let proto = ctor?.prototype;
    while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) {
            if (name === 'constructor') continue;
            const descriptor = Object.getOwnPropertyDescriptor(proto, name);
            if (typeof descriptor?.value === 'function') found.add(name);
        }
        proto = Object.getPrototypeOf(proto);
    }
    return [...found];
}

/* The entry point is whichever method the submission added. Where it added
 * several, the conventional names win, and a class field holding a function is
 * considered too because the tree writes some methods as arrow properties. */
function findEntryPoint(
    instance: Record<string, any>,
    ctor: any,
    className: string,
    preferred: string[],
): { name: string; call: (...args: any[]) => any } | null {
    const preexisting = new Set(spec.preexistingMethods[className] ?? []);
    const candidates = ownMethods(ctor).filter((name) => !preexisting.has(name) && !name.startsWith('_'));
    const ordered = [
        ...preferred.filter((name) => candidates.includes(name)),
        ...candidates.filter((name) => !preferred.includes(name)),
    ];
    for (const name of ordered) {
        if (typeof instance[name] === 'function') {
            return { name, call: instance[name].bind(instance) };
        }
    }
    // Arrow-function class fields live on the instance, not the prototype, so
    // they are looked for separately and only by conventional name.
    for (const name of preferred) {
        if (typeof instance[name] === 'function') {
            return { name, call: instance[name].bind(instance) };
        }
    }
    return null;
}

/* Building the instance through its constructor matters: a class field with an
 * initialiser -- somewhere to keep a batch, or a set of what has been seen -- is
 * only set up when the constructor runs, and a submission that keeps state that
 * way would otherwise be handed an object with the field missing. The collaborators
 * are attached by name afterwards, so whatever the constructor took is replaced
 * by the real thing. A constructor that will not accept stand-ins falls back to a
 * bare prototype, which is no worse than not trying. */
function instantiate(ctor: any, arity: number): Record<string, any> {
    const stub = new Proxy(
        {},
        {
            get: (_target, property) => (property === 'then' ? undefined : () => undefined),
        },
    );
    try {
        return Reflect.construct(ctor, Array.from({ length: arity }, () => stub));
    } catch {
        return Object.create(ctor.prototype);
    }
}

const influx = new InfluxService();

/* The billable write is event driven in this tree: publishing a measurement
 * emits it and a subscriber indexes it. Nothing else starts that subscriber
 * outside the Nest bootstrap, so the driver starts it. */
StandardMeasurementEntity.subscribe(influx);

const stubEnvironment = {
    getEnvironmentsForUser: async () => [{ businessID: spec.tenant }],
};

const stubScheduler = {
    create: async () => ({ message: 'scheduled' }),
    remove: async () => ({ message: 'removed' }),
};

function buildTokenService(): Record<string, any> {
    const target = instantiate(TokenConsumerService, 4);
    attach(target, INFLUX_ALIASES, influx);
    attach(target, SCHEDULER_ALIASES, stubScheduler);
    attach(target, ENVIRONMENT_ALIASES, stubEnvironment);
    attach(target, JWT_ALIASES, { signIn: async () => ({ access_token: '' }) });
    return target;
}

function buildProcessor(tokenService: Record<string, any>): Record<string, any> {
    const target = instantiate(TokenConsumerAsyncProcessor, 5);
    attach(target, INFLUX_ALIASES, influx);
    attach(target, TOKEN_SERVICE_ALIASES, tokenService);
    attach(target, ['offeringService', 'customerService', 'dimensionService', 'dimensionsService'], {
        findAll: async () => ({ data: [] }),
    });
    return target;
}

const at = (offsetSeconds: number) => new Date(baseMs + offsetSeconds * 1000).toISOString();

/* Buffered writes are the point of the batching, so the driver asks the client
 * to hand over whatever it is holding rather than waiting out its interval.
 * Every bucket the submission opened is flushed, whichever it chose. */
async function flushAll(): Promise<void> {
    const apis = (influx as any).writeApis ?? {};
    for (const bucket of Object.keys(apis)) {
        try {
            await apis[bucket]?.flush();
        } catch {
            /* a submission may have closed it already */
        }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
}

async function main() {
    const results: Record<string, unknown> = {};
    const diagnostics: Record<string, unknown> = {};

    // The platform's own customer for each tenant, warmed into the same cache
    // the surviving lookup reads, so no part of the run depends on the dogfood
    // customer query.
    const store: any = await (cache as any);
    const warm = async (tenant: string, customerId: string, business: string) => {
        await store.set(
            TokenConsumerService.cacheKey(tenant),
            JSON.stringify({
                customerId,
                saasCustomerAssociatedBusinessID: business,
                customerRes: { customerId, businessID: business, customerName: tenant },
            }),
        );
    };
    await warm(spec.tenant, spec.platformCustomer, spec.platformBusiness);
    // The second tenant's platform customer belongs to a different account of
    // the platform's, which is what makes the account a call is billed to a
    // question about the customer rather than a constant.
    await warm(OTHER_TENANT, spec.otherPlatformCustomer, spec.otherPlatformBusiness);

    const tokenService = buildTokenService();
    const processor = buildProcessor(tokenService);

    const register = findEntryPoint(tokenService, TokenConsumerService, 'TokenConsumerService', REGISTER_NAMES);
    const aggregate = findEntryPoint(
        processor,
        TokenConsumerAsyncProcessor,
        'TokenConsumerAsyncProcessor',
        AGGREGATE_NAMES,
    );
    diagnostics.registerEntryPoint = register?.name ?? null;
    diagnostics.aggregateEntryPoint = aggregate?.name ?? null;

    for (const step of spec.steps) {
        try {
            if (step.op === 'register') {
                if (!register) throw new Error('no registration entry point on the token consumer service');
                const tenant = step.customer === 'other' ? OTHER_TENANT : spec.tenant;
                await register.call({
                    businessID: tenant,
                    subject: spec.subject,
                    tokenAmount: String(spec.amount),
                    metadata: { tokenType: 'apiCall', uuid: spec.calls[step.call as string] },
                    timestamp: at(step.atOffset as number),
                });
                results[step.label] = { ok: true };
            } else if (step.op === 'flush') {
                await flushAll();
                results[step.label] = { ok: true };
            } else if (step.op === 'aggregate') {
                if (!aggregate) throw new Error('no aggregation entry point on the token consumer processor');
                const parameters = {
                    businessID: step.tenant === 'other' ? OTHER_TENANT : spec.tenant,
                    subject: spec.subject,
                    dimensionType: TokenConsumerAsyncProcessor.aggregationProcessor,
                    startDate: at(step.startOffset as number),
                    endDate: at(step.endOffset as number),
                };
                // A scheduled job in this tree arrives as a queue job whose
                // data is a scheduler record carrying its own parameters, which
                // is the shape the surviving scheduling call builds. Flatter
                // shapes are offered after it so a submission that reads the
                // window straight off the job is not penalised.
                const shapes = [
                    { data: { ...parameters, rate: '0 */6 * * *', scheduleParameters: { ...parameters } } },
                    { data: { ...parameters, rate: '0 */6 * * *' } },
                    { ...parameters },
                ];
                let accepted = false;
                for (const [index, shape] of shapes.entries()) {
                    try {
                        await aggregate.call(shape);
                        accepted = true;
                        break;
                    } catch (shapeError) {
                        diagnostics[`${step.label}.shape${index}`] = describeError(shapeError);
                    }
                }
                if (!accepted) throw new Error('the aggregation entry point rejected every job shape offered');
                await flushAll();
                results[step.label] = { ok: true };
            } else if (step.op === 'usage.create') {
                // The path that produces the traffic in the first place. The
                // real token service is attached, so whatever the request path
                // meters is written to the store and can be read back there
                // instead of being taken on this process' word. It runs after
                // the graded windows have closed.
                const usage = instantiate(UsageService, 6);
                attach(usage, INFLUX_ALIASES, influx);
                attach(usage, TOKEN_SERVICE_ALIASES, tokenService);
                attach(usage, ['measurementConfigService', 'dimensionService', 'dimensionsService',
                    'customerService', 'offeringService'], { findAll: async () => ({ data: [] }) });
                await usage.create(
                    {
                        businessID: spec.tenant,
                        customerId: spec.tenantMeasurement.customerId,
                        dimensionId: spec.tenantMeasurement.dimensionId,
                        recordValue: spec.tenantMeasurement.recordValue,
                        timestamp: at(-600),
                    },
                    spec.subject,
                );
                await flushAll();
                results[step.label] = { ok: true };
            } else {
                throw new Error(`unknown op ${step.op}`);
            }
        } catch (error) {
            results[step.label] = { ok: false, error: describeError(error) };
        }
    }

    await flushAll();
    writeFileSync(config.out, JSON.stringify({ steps: results, diagnostics }, null, 2));
}

main().then(
    () => process.exit(0),
    (error) => {
        writeFileSync(config.out, JSON.stringify({ fatal: String((error as Error)?.stack ?? error) }, null, 2));
        process.exit(0);
    },
);
