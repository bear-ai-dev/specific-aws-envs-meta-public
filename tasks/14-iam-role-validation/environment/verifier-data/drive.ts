/*
 * Trusted driver. Runs inside the deliverable so module resolution matches the
 * project exactly, stands the settings API up on a loopback port with an
 * in-memory store behind it, and posts one settings save after another exactly
 * as the console would.
 *
 * Everything this file touches belongs to the submission, so nothing it prints
 * or returns is treated as a verdict: it only transports observations. The
 * status the endpoint answered with and the settings a caller can read back
 * afterwards are the whole record; what the submission did in between is not
 * inspected.
 */
import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { Module, Provider, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthGuard } from '@nestjs/passport';
import { useContainer } from 'class-validator';

import { SettingsController } from './src/setting/settings.controller.js';
import { SettingsService } from './src/setting/settings.service.js';
import { InfluxService } from './src/influx/influx.service.js';
import { SchedulerService } from './src/scheduler/scheduler.service.js';
import { EnvironmentService } from './src/users/users.service.js';

type Run = { label: string; body: Record<string, unknown> };
type Config = { businessID: string; subject: string; runs: Run[]; out: string };

const config = JSON.parse(readFileSync(process.argv[2], 'utf8')) as Config;

// ---------------------------------------------------------------------------
// the store the settings service writes through
// ---------------------------------------------------------------------------

let row: Record<string, unknown> | null = null;

function makePoint() {
    const record: Record<string, unknown> = {};
    const point: Record<string, unknown> = {
        __record: record,
        tag: (key: string, value: unknown) => {
            if (value !== undefined && value !== null) {
                record[key] = String(value);
            }
            return point;
        },
        stringField: (key: string, value: unknown) => {
            // `businessName` is the measurement's only field; the influx reader
            // in this tree surfaces it as `_value`.
            const target = key === 'businessName' ? '_value' : key;
            record[target] = value === undefined || value === null ? '' : String(value);
            return point;
        },
        floatField: () => point,
        booleanField: () => point,
        intField: () => point,
        timestamp: () => point,
    };
    return point;
}

const influx = {
    getPoint: (_measurement?: string) => makePoint(),
    loadPoints: async (_bucket: string, _org: string, points: Array<Record<string, unknown>>) => {
        for (const point of points ?? []) {
            const record = point?.__record as Record<string, unknown> | undefined;
            if (record) {
                row = { ...record };
            }
        }
    },
    getLatestSettings: async (_args: { businessID: string }) => (row ? [{ ...row }] : []),
    getLatestFreeTrial: async () => [],
    getLatestCustomers: async () => [],
    getLatestCustomer: async () => [],
    getAllDimensions: async () => [],
    readEnvironmentForBusiness: async () => [],
};

const environment = {
    getEnvironmentForBusinessID: async (_businessID: string) => ({ environment: 'sandbox' }),
    readEnvironmentForBusiness: async () => [],
    readAllEnvironmentsForUser: async () => [],
};

const scheduler = {
    create: async () => ({}),
    delete: async () => ({}),
    get: async () => ({}),
    update: async () => ({}),
};

// A submission is free to express the rule as an injectable validator rather
// than a plain decorator, so anything the settings module declares as a
// provider is carried across into the module assembled here.
async function extraProviders(): Promise<Provider[]> {
    try {
        const settingsModule = await import('./src/setting/settings.module.js');
        const found: Provider[] = [];
        for (const exported of Object.values(settingsModule)) {
            if (typeof exported !== 'function') continue;
            const declared = Reflect.getMetadata('providers', exported) as Provider[] | undefined;
            for (const provider of declared ?? []) {
                if (typeof provider === 'function' && !found.includes(provider)) {
                    found.push(provider);
                }
            }
        }
        return found.filter((provider) => provider !== SettingsService);
    } catch {
        return [];
    }
}

async function build() {
    const providers: Provider[] = [
        SettingsService,
        ...(await extraProviders()),
        { provide: InfluxService, useValue: influx },
        { provide: SchedulerService, useValue: scheduler },
        { provide: EnvironmentService, useValue: environment },
    ];

    @Module({ controllers: [SettingsController], providers })
    class DriverModule {}

    const moduleRef = await Test.createTestingModule({ imports: [DriverModule] })
        .overrideGuard(AuthGuard('jwt'))
        .useValue({
            canActivate: (context: {
                switchToHttp: () => { getRequest: () => Record<string, unknown> };
            }) => {
                context.switchToHttp().getRequest().user = {
                    businessID: config.businessID,
                    sub: config.subject,
                };
                return true;
            },
        })
        .compile();

    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    useContainer(app.select(DriverModule), { fallbackOnErrors: true });
    await app.init();
    await app.listen(0);
    return app;
}

// ---------------------------------------------------------------------------

function projection(payload: unknown): Record<string, unknown> {
    const list = Array.isArray(payload) ? payload : [];
    const settings = (list[0] ?? {}) as Record<string, unknown>;
    const cloud = (settings.cloudIAM ?? {}) as Record<string, unknown>;
    return {
        iamRoleArn: typeof cloud.iamRoleArn === 'string' ? cloud.iamRoleArn : '',
        externalId: typeof cloud.externalId === 'string' ? cloud.externalId : '',
        city: typeof settings.city === 'string' ? settings.city : '',
        vatId: typeof settings.vatId === 'string' ? settings.vatId : '',
        businessName: typeof settings.businessName === 'string' ? settings.businessName : '',
        supportEmail: typeof settings.supportEmail === 'string' ? settings.supportEmail : '',
    };
}

async function main() {
    const app = await build();
    const base = await app.getUrl();
    const observations: Record<string, unknown> = {};

    for (const run of config.runs) {
        let status = 0;
        let error = '';
        try {
            const response = await fetch(`${base}/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(run.body),
            });
            status = response.status;
            await response.text();
        } catch (caught) {
            // A submission that makes the endpoint unreachable has answered
            // nothing, which is a wrong answer rather than a broken run.
            error = String((caught as Error)?.message ?? caught);
        }

        let settings: Record<string, unknown> = projection([]);
        let readError = '';
        try {
            const response = await fetch(`${base}/settings`, { method: 'GET' });
            const body = await response.text();
            try {
                settings = projection(JSON.parse(body));
            } catch {
                readError = 'settings could not be read back';
            }
        } catch (caught) {
            readError = String((caught as Error)?.message ?? caught);
        }

        observations[run.label] = { status, error, readError, settings };
    }

    writeFileSync(config.out, JSON.stringify({ observations }, null, 2));
    await app.close();
}

main().then(
    () => process.exit(0),
    (error) => {
        writeFileSync(config.out, JSON.stringify({ fatal: String(error?.stack ?? error) }, null, 2));
        process.exit(0);
    },
);
