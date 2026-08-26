/*
 * Trusted driver.
 *
 * Stands the submitted settings surface up on a loopback port with the
 * project's own global pipe and container wiring, replays a fixed list of
 * saves against businesses it has never seen, and records what each call
 * answered and what a read-back afterwards returned.
 *
 * Everything here loads submitted code, so nothing it prints is a verdict: it
 * only transports observations. The ledger the saves land in is read
 * separately, over the emulator's admin channel, by code that loads nothing
 * from the deliverable.
 */
import { Test } from '@nestjs/testing';
import { ValidationPipe, ExecutionContext, CanActivate } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { useContainer } from 'class-validator';

import { writeFileSync } from 'node:fs';
import http from 'node:http';

// The settings module sits inside an import cycle with the tax module, so the
// application root is pulled in first to fix the evaluation order the way the
// running service does.
import './src/app.module';
import * as settingsModule from './src/setting/settings.module';
import { SettingsService } from './src/setting/settings.service';
import { InfluxService } from './src/influx/influx.service';
import { EnvironmentService } from './src/users/users.service';
import { SchedulerService } from './src/scheduler/scheduler.service';

type Step = {
    label: string;
    businessID: string;
    surface: 'settings' | 'profile';
    payload: Record<string, unknown>;
};

const config = JSON.parse(process.argv[2]) as { steps: Step[]; out: string };

/** Records every schedule the submission asks for, without running any. */
class RecordingScheduler {
    public readonly created: Array<Record<string, unknown>> = [];
    public readonly removed: Array<Record<string, unknown>> = [];

    async create(dto: Record<string, unknown>) {
        this.created.push({ ...dto });
        return { message: 'Cron expression added', data: [{ id: dto.schedulerID }] };
    }
    async remove(dto: Record<string, unknown>) {
        this.removed.push({ ...dto });
        return { message: 'Schedule removed' };
    }
    async findAll() {
        return { data: [], message: 'Found Schedules' };
    }
    async findOne() {
        return { data: [], message: 'Found Schedules' };
    }
    async update(dto: Record<string, unknown>) {
        this.created.push({ ...dto });
        return { message: 'Cron expression updated', data: [{ id: dto.schedulerID }] };
    }
}

/** Stands in for the tenant directory; every business here is a sandbox one. */
const environmentService = {
    getEnvironmentForBusinessID: async () => ({ environment: 'sandbox' }),
    findAll: async () => [],
};

/** The console's caller identity, handed over per request by header. */
class HeaderIdentityGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest();
        request.user = {
            businessID: request.headers['x-verifier-business'],
            sub: 'verifier|console',
            businessName: 'verifier',
        };
        return true;
    }
}

function declaredControllers(): any[] {
    const found: any[] = [];
    for (const exported of Object.values(settingsModule as Record<string, any>)) {
        if (typeof exported !== 'function') continue;
        const controllers = Reflect.getMetadata('controllers', exported);
        if (Array.isArray(controllers)) {
            for (const controller of controllers) {
                if (!found.includes(controller)) found.push(controller);
            }
        }
    }
    return found;
}

function declaredProviders(): any[] {
    const found: any[] = [];
    for (const exported of Object.values(settingsModule as Record<string, any>)) {
        if (typeof exported !== 'function') continue;
        const providers = Reflect.getMetadata('providers', exported);
        if (Array.isArray(providers)) {
            for (const provider of providers) {
                if (!found.includes(provider)) found.push(provider);
            }
        }
    }
    if (!found.includes(SettingsService)) found.push(SettingsService);
    return found;
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD', 'SEARCH'];

/** Every route the submitted controllers register, with its method and path. */
function routeTable(controllers: any[]): Array<{ method: string; path: string }> {
    const routes: Array<{ method: string; path: string }> = [];
    const join = (base: string, leaf: string) =>
        `/${[base, leaf].map((part) => String(part ?? '').replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;

    for (const controller of controllers) {
        const base = Reflect.getMetadata('path', controller) ?? '';
        let prototype = controller.prototype;
        const seen = new Set<string>();
        while (prototype && prototype !== Object.prototype) {
            for (const name of Object.getOwnPropertyNames(prototype)) {
                if (name === 'constructor' || seen.has(name)) continue;
                seen.add(name);
                const handler = Object.getOwnPropertyDescriptor(prototype, name)?.value;
                if (typeof handler !== 'function') continue;
                const leaf = Reflect.getMetadata('path', handler);
                const verb = Reflect.getMetadata('method', handler);
                if (leaf === undefined || verb === undefined) continue;
                const route = { method: HTTP_METHODS[verb] ?? 'GET', path: join(base, leaf) };
                if (!routes.some((r) => r.method === route.method && r.path === route.path)) routes.push(route);
            }
            prototype = Object.getPrototypeOf(prototype);
        }
    }
    return routes;
}

function request(
    port: number,
    method: string,
    path: string,
    businessID: string,
    body?: unknown,
): Promise<{ status: number; body: any }> {
    return new Promise((resolve) => {
        const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                method,
                path,
                headers: {
                    'content-type': 'application/json',
                    'x-verifier-business': businessID,
                    ...(payload ? { 'content-length': String(payload.length) } : {}),
                },
            },
            (res) => {
                const chunks: Buffer[] = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const text = Buffer.concat(chunks).toString('utf8');
                    let parsed: any = text;
                    try {
                        parsed = text ? JSON.parse(text) : null;
                    } catch {
                        /* a non-JSON body is reported as the raw text */
                    }
                    resolve({ status: res.statusCode ?? 0, body: parsed });
                });
            },
        );
        req.on('error', (error) => resolve({ status: 0, body: { error: String(error) } }));
        if (payload) req.write(payload);
        req.end();
    });
}

/*
 * The reader this tree ships bounds its query at `stop: new Date().toISOString()`,
 * which is millisecond-truncated, and a Flux range excludes its stop. A row the
 * save has just written is therefore invisible to a read-back issued inside the
 * same millisecond, and the reader falls through to the business's previous row.
 * The write timestamp comes from the Influx client, which derives nanoseconds
 * from a monotonic clock against a millisecond-granular origin sampled once per
 * process, so it can lead the wall clock by up to about a millisecond -- a fixed
 * bias per run, which is why this surfaces as a whole run going bad rather than
 * as the odd step.
 *
 * Nothing a submission can do avoids it: the reader, the entity and the client
 * are all outside the deliverable. So the driver puts real time between the save
 * and the read-back, comfortably clear of that bias, rather than letting a
 * correct-but-fast save be recorded as having served a stale document.
 */
const READ_BACK_GAP_MS = 25;

const settle = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function main() {
    const scheduler = new RecordingScheduler();
    const controllers = declaredControllers();

    const builder = Test.createTestingModule({
        controllers,
        providers: [...declaredProviders(), InfluxService, EnvironmentService, SchedulerService],
    })
        .overrideProvider(EnvironmentService)
        .useValue(environmentService)
        .overrideProvider(SchedulerService)
        .useValue(scheduler)
        .overrideGuard(AuthGuard('jwt'))
        .useValue(new HeaderIdentityGuard());

    const moduleRef = await builder.compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    useContainer(app as any, { fallbackOnErrors: true });
    await app.init();
    await app.listen(0);
    const port = (app.getHttpServer().address() as any).port as number;

    const routes = routeTable(controllers);
    const saveRoutes = routes.filter((r) => r.method !== 'GET' && !/free-trial|invoiceImage|image/i.test(r.path));
    const profileSave = saveRoutes.filter((r) => /profile/i.test(r.path));
    const documentSave = saveRoutes.filter((r) => !/profile/i.test(r.path));
    const readRoutes = routes.filter((r) => r.method === 'GET' && !/free-trial|profile/i.test(r.path));

    const observed: Record<string, unknown> = {};
    for (const step of config.steps) {
        const candidates = step.surface === 'profile' ? profileSave : documentSave;
        const createdBefore = scheduler.created.length;
        const removedBefore = scheduler.removed.length;

        let save: { status: number; body: any } = { status: 0, body: { error: 'no save route is registered' } };
        let usedRoute: string = '';
        for (const route of candidates) {
            save = await request(port, route.method, route.path, step.businessID, step.payload);
            usedRoute = `${route.method} ${route.path}`;
            if (save.status !== 404 && save.status !== 405) break;
        }

        await settle(READ_BACK_GAP_MS);

        let read: { status: number; body: any } = { status: 0, body: null };
        for (const route of readRoutes) {
            read = await request(port, route.method, route.path, step.businessID);
            if (read.status !== 404) break;
        }

        observed[step.label] = {
            route: usedRoute,
            saveStatus: save.status,
            saveBody: save.body,
            readStatus: read.status,
            readBody: read.body,
            scheduled: scheduler.created.slice(createdBefore),
            unscheduled: scheduler.removed.slice(removedBefore),
        };
    }

    writeFileSync(config.out, JSON.stringify({ routes, observed }, null, 2));
    await app.close();
}

main().then(
    () => process.exit(0),
    (error) => {
        writeFileSync(config.out, JSON.stringify({ fatal: String(error?.stack ?? error) }, null, 2));
        process.exit(0);
    },
);
