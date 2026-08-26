import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { fetch } from 'cross-fetch';
import { InfluxService } from '../influx/influx.service.js';
import { Environment } from '../users/dto/Environment.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { EnvironmentService } from '../users/users.service.js';
import { KeysService } from './keys.service.js';

jest.mock('../cacheStore');
jest.mock('cross-fetch', () => ({ fetch: jest.fn() }));

const fetchMock = fetch as unknown as jest.Mock;

const PRODUCTION_BUSINESS_ID = 'harborline';
const SANDBOX_BUSINESS_ID = 'harborline-sandbox';
const SUBJECT = 'auth0|opharborline77';

const productionRows = [
    { subject: 'keyProdIngest@clients', businessID: PRODUCTION_BUSINESS_ID, environment: Environment.PRODUCTION },
    { subject: 'keyProdReports@clients', businessID: PRODUCTION_BUSINESS_ID, environment: Environment.PRODUCTION },
    // The person who signs in to the console is not a key
    { subject: SUBJECT, businessID: PRODUCTION_BUSINESS_ID, environment: Environment.PRODUCTION },
];
const sandboxRows = [
    { subject: 'keySbxIngest@clients', businessID: SANDBOX_BUSINESS_ID, environment: Environment.SANDBOX },
    { subject: SUBJECT, businessID: SANDBOX_BUSINESS_ID, environment: Environment.SANDBOX },
];

const identityProviderClients = [
    { client_id: 'keyProdIngest', name: 'Production ingest' },
    { client_id: 'keyProdReports', name: 'Production reporting' },
    { client_id: 'keySbxIngest', name: 'Sandbox ingest' },
    { client_id: 'keyOtherTenant', name: 'Somebody elses key' },
    { client_id: 'appNeverClaimed', name: 'Known to the provider, never claimed' },
];

/**
 * The identity provider, answering the same shapes the hosted one does.
 */
function respondAsIdentityProvider() {
    fetchMock.mockImplementation((url: string, options?: { method?: string }) => {
        const method = options?.method || 'GET';
        if (url.includes('/oauth/token')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({ access_token: 'management-token', expires_in: 86400 }),
            });
        }
        if (url.includes('/api/v2/clients?')) {
            return Promise.resolve({
                ok: true,
                status: 200,
                json: async () => ({
                    start: 0,
                    limit: 100,
                    total: identityProviderClients.length,
                    clients: identityProviderClients,
                }),
            });
        }
        const single = /\/api\/v2\/clients\/([^/?]+)(\/rotate-secret)?$/.exec(url);
        if (single) {
            const clientId = decodeURIComponent(single[1]);
            const client = identityProviderClients.find(({ client_id }) => client_id === clientId);
            if (!client) {
                return Promise.resolve({
                    ok: false,
                    status: 404,
                    json: async () => ({ statusCode: 404, error: 'Not Found' }),
                    text: async () => 'not found',
                });
            }
            if (single[2] && method === 'POST') {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: async () => ({ ...client, client_secret: `rotated-${clientId}` }),
                });
            }
            if (method === 'DELETE') {
                return Promise.resolve({ ok: true, status: 204, json: async () => ({}), text: async () => '' });
            }
            return Promise.resolve({ ok: true, status: 200, json: async () => client });
        }
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}), text: async () => 'unexpected' });
    });
}

describe('KeysService', () => {
    let keysService: KeysService;
    let mockLoadPoints: jest.Mock;
    let mockReadAllUsersForBusiness: jest.Mock;
    let mockGetCurrentEnvironment: jest.Mock;
    let mockGetEnvironmentsForUser: jest.Mock;

    beforeEach(async () => {
        respondAsIdentityProvider();
        mockLoadPoints = jest.fn();
        mockReadAllUsersForBusiness = jest.fn((businessID: string) =>
            businessID === SANDBOX_BUSINESS_ID ? sandboxRows : productionRows,
        );
        mockGetCurrentEnvironment = jest.fn(async () => ({
            message: 'Found environment',
            subject: SUBJECT,
            environment: Environment.PRODUCTION,
        }));
        mockGetEnvironmentsForUser = jest.fn(async () => [
            new UserEntity({
                subject: SUBJECT,
                businessID: PRODUCTION_BUSINESS_ID,
                environment: Environment.PRODUCTION,
            }),
            new UserEntity({ subject: SUBJECT, businessID: SANDBOX_BUSINESS_ID, environment: Environment.SANDBOX }),
        ]);

        const module: TestingModule = await Test.createTestingModule({
            providers: [KeysService],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: jest.fn(), stringField: jest.fn() }),
                        readAllUsersForBusiness: mockReadAllUsersForBusiness,
                    };
                }
                if (token === EnvironmentService) {
                    return {
                        getCurrentEnvironment: mockGetCurrentEnvironment,
                        getEnvironmentsForUser: mockGetEnvironmentsForUser,
                    };
                }
            })
            .compile();

        keysService = module.get<KeysService>(KeysService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(keysService).toBeDefined();
    });

    it('lists the keys the account holds in the environment the caller is in', async () => {
        const { data } = await keysService.findAll({ subject: SUBJECT });
        expect(data.map(({ keyId }) => keyId)).toEqual(['keyProdIngest', 'keyProdReports']);
        expect(data.every(({ businessID }) => businessID === PRODUCTION_BUSINESS_ID)).toBe(true);
        expect(data.every(({ environment }) => environment === Environment.PRODUCTION)).toBe(true);
    });

    it('lists the other environments keys once the caller moves environment', async () => {
        mockGetCurrentEnvironment.mockImplementation(async () => ({
            message: 'Found environment',
            subject: SUBJECT,
            environment: Environment.SANDBOX,
        }));
        const { data } = await keysService.findAll({ subject: SUBJECT });
        expect(data.map(({ keyId }) => keyId)).toEqual(['keySbxIngest']);
        expect(mockReadAllUsersForBusiness).toBeCalledWith(SANDBOX_BUSINESS_ID);
    });

    it('honours the environment the request is made in', async () => {
        const { data } = await keysService.findAll({ subject: SUBJECT, environment: Environment.SANDBOX });
        expect(data.map(({ keyId }) => keyId)).toEqual(['keySbxIngest']);
    });

    it('refuses an environment that is not one of the two', async () => {
        await expect(keysService.findAll({ subject: SUBJECT, environment: 'staging' })).rejects.toThrow(
            BadRequestException,
        );
    });

    it('rotates the secret of a key the account holds', async () => {
        const response = await keysService.rotate({ keyId: 'keyProdIngest', subject: SUBJECT });
        expect(response.clientSecret).toBe('rotated-keyProdIngest');
        expect(response.client_secret).toBe('rotated-keyProdIngest');
        expect(response.keyId).toBe('keyProdIngest');
        const rotations = fetchMock.mock.calls.filter(([url]) => `${url}`.includes('rotate-secret'));
        expect(rotations).toHaveLength(1);
        expect(`${rotations[0][0]}`).toContain('keyProdIngest');
    });

    it('accepts the account a key signs in as in place of its id', async () => {
        const response = await keysService.rotate({ keyId: 'keyProdIngest@clients', subject: SUBJECT });
        expect(response.keyId).toBe('keyProdIngest');
    });

    it.each([
        ['another tenants key', 'keyOtherTenant'],
        ['a key of the other environment', 'keySbxIngest'],
        ['a key the tenant never claimed', 'appNeverClaimed'],
        ['a key nobody has ever heard of', 'keyMadeUp'],
    ])('refuses to rotate %s and leaves it exactly as it was', async (_description, keyId) => {
        await expect(keysService.rotate({ keyId, subject: SUBJECT })).rejects.toThrow(NotFoundException);
        expect(fetchMock.mock.calls.filter(([url]) => `${url}`.includes('rotate-secret'))).toHaveLength(0);
    });

    it.each([
        ['another tenants key', 'keyOtherTenant'],
        ['a key of the other environment', 'keySbxIngest'],
        ['a key the tenant never claimed', 'appNeverClaimed'],
        ['a key nobody has ever heard of', 'keyMadeUp'],
    ])('refuses to retire %s and leaves it exactly as it was', async (_description, keyId) => {
        await expect(keysService.remove({ keyId, subject: SUBJECT })).rejects.toThrow(NotFoundException);
        const deletions = fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE');
        expect(deletions).toHaveLength(0);
        expect(mockLoadPoints).not.toBeCalled();
    });

    it('retires a key at the identity provider and in the configuration store', async () => {
        const response = await keysService.remove({ keyId: 'keyProdReports', subject: SUBJECT });
        expect(response.keyId).toBe('keyProdReports');
        const deletions = fetchMock.mock.calls.filter(([, options]) => options?.method === 'DELETE');
        expect(deletions).toHaveLength(1);
        expect(`${deletions[0][0]}`).toContain('keyProdReports');
        // The account the credential signs in as is taken out of the tenants
        // configuration, so the next request presenting it resolves to nothing
        expect(mockLoadPoints).toBeCalledTimes(1);
    });

    it('refuses a request from a subject with no account at all', async () => {
        mockGetEnvironmentsForUser.mockImplementation(async () => {
            throw new NotFoundException('User was not found');
        });
        await expect(keysService.findAll({ subject: 'auth0|nobody' })).rejects.toThrow(NotFoundException);
    });
});
