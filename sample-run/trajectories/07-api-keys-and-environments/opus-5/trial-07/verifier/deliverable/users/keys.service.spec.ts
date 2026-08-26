import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService, KeysService } from './users.service.js';
import { Environment } from './dto/Environment.js';
import { ApiKeyEntity } from './entities/apiKey.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { EnvironmentEntity } from './entities/environment.entity.js';
import { cache as cacheManager } from '../cacheStore.js';

jest.mock('../cacheStore');

const CONSOLE_SUBJECT = 'auth0|person';
const BUSINESS_ID = 'myCoolCorp';

const userRow = (subject: string, businessID: string, environment: Environment) => ({
    subject,
    businessID,
    environment,
    _field: 'userStatus',
    _value: 'live',
    _measurement: UserEntity._measurementActiveEnvironment,
    _time: new Date().toISOString(),
});

const environmentRow = (subject: string, environment: Environment) => ({
    subject,
    _field: 'environment',
    _value: environment,
    _measurement: EnvironmentEntity._measurement,
    _time: new Date().toISOString(),
});

describe('KeysService', () => {
    let keysService: KeysService;
    let readCurrentUserEnv: jest.Mock;
    let readUserData: jest.Mock;
    let readAllUsersForBusiness: jest.Mock;
    let loadPoints: jest.Mock;
    let listClients: jest.SpyInstance;
    let rotateSecret: jest.SpyInstance;
    let deleteClient: jest.SpyInstance;

    beforeEach(async () => {
        readCurrentUserEnv = jest.fn(() => [environmentRow(CONSOLE_SUBJECT, Environment.PRODUCTION)]);
        readUserData = jest.fn((subject, environment) =>
            environment === Environment.PRODUCTION && subject === CONSOLE_SUBJECT
                ? [userRow(CONSOLE_SUBJECT, BUSINESS_ID, Environment.PRODUCTION)]
                : [],
        );
        readAllUsersForBusiness = jest.fn(() => []);
        loadPoints = jest.fn();
        listClients = jest.spyOn(ApiKeyEntity, 'listClients').mockResolvedValue(new Map());
        rotateSecret = jest
            .spyOn(ApiKeyEntity, 'rotateSecret')
            .mockResolvedValue({ client_id: 'liveKey', name: 'Live key', client_secret: 'aFreshSecret' });
        deleteClient = jest.spyOn(ApiKeyEntity, 'deleteClient').mockResolvedValue(undefined);
        jest.spyOn(OrganizationEntity, 'getAuth0ManagementToken').mockResolvedValue({ access_token: 'aToken' });

        const module: TestingModule = await Test.createTestingModule({
            providers: [KeysService, EnvironmentService],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        readCurrentUserEnv,
                        readUserData,
                        readAllUsersForBusiness,
                        loadPoints,
                        getPoint: () => ({ tag: jest.fn(), stringField: jest.fn() }),
                    };
                }
            })
            .compile();
        keysService = module.get<KeysService>(KeysService);
        cacheManager.del = jest.fn();
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should be defined', () => {
        expect(keysService).toBeDefined();
    });

    it('lists the keys the account holds in the environment the caller is in', async () => {
        readAllUsersForBusiness.mockImplementation(() => [
            userRow(CONSOLE_SUBJECT, BUSINESS_ID, Environment.PRODUCTION),
            userRow('liveKey@clients', BUSINESS_ID, Environment.PRODUCTION),
            userRow('unknownToTheProvider@clients', BUSINESS_ID, Environment.PRODUCTION),
        ]);
        listClients.mockResolvedValue(new Map([['liveKey', { client_id: 'liveKey', name: 'Live key' }]]));

        const { data } = await keysService.findAll({ subject: CONSOLE_SUBJECT });

        expect(readAllUsersForBusiness).toBeCalledWith(BUSINESS_ID);
        // The person, and a key the identity provider no longer holds, are not keys.
        expect(data).toHaveLength(1);
        expect(data[0].client_id).toEqual('liveKey');
        expect(data[0].clientId).toEqual('liveKey');
        expect(data[0].subject).toEqual('liveKey@clients');
        expect(data[0].environment).toEqual(Environment.PRODUCTION);
        expect(JSON.stringify(data)).not.toContain('secret');
    });

    it('refuses a caller with no account in the current environment', async () => {
        readUserData.mockImplementation(() => []);
        await expect(keysService.findAll({ subject: CONSOLE_SUBJECT })).rejects.toThrow(UnauthorizedException);
    });

    it('rotates the secret of a single key the account holds', async () => {
        readUserData.mockImplementation((subject) =>
            subject === CONSOLE_SUBJECT
                ? [userRow(CONSOLE_SUBJECT, BUSINESS_ID, Environment.PRODUCTION)]
                : [userRow('liveKey@clients', BUSINESS_ID, Environment.PRODUCTION)],
        );

        const response = await keysService.rotate({ keyId: 'liveKey', subject: CONSOLE_SUBJECT });

        expect(rotateSecret).toBeCalledTimes(1);
        expect(rotateSecret).toBeCalledWith('liveKey', 'aToken');
        expect(response.client_secret).toEqual('aFreshSecret');
        expect(response.clientSecret).toEqual('aFreshSecret');
        expect(deleteClient).not.toBeCalled();
        expect(loadPoints).not.toBeCalled();
    });

    it('refuses a key the account does not hold and leaves it exactly as it was', async () => {
        readUserData.mockImplementation((subject) =>
            subject === CONSOLE_SUBJECT
                ? [userRow(CONSOLE_SUBJECT, BUSINESS_ID, Environment.PRODUCTION)]
                : [userRow('someoneElsesKey@clients', 'someoneElse', Environment.PRODUCTION)],
        );

        await expect(keysService.rotate({ keyId: 'someoneElsesKey', subject: CONSOLE_SUBJECT })).rejects.toThrow(
            NotFoundException,
        );
        await expect(keysService.remove({ keyId: 'someoneElsesKey', subject: CONSOLE_SUBJECT })).rejects.toThrow(
            NotFoundException,
        );
        expect(rotateSecret).not.toBeCalled();
        expect(deleteClient).not.toBeCalled();
        expect(loadPoints).not.toBeCalled();
    });

    it('refuses a key which is not configured at all, such as one already retired', async () => {
        readUserData.mockImplementation((subject) =>
            subject === CONSOLE_SUBJECT ? [userRow(CONSOLE_SUBJECT, BUSINESS_ID, Environment.PRODUCTION)] : [],
        );

        await expect(keysService.rotate({ keyId: 'retiredKey', subject: CONSOLE_SUBJECT })).rejects.toThrow(
            NotFoundException,
        );
        expect(rotateSecret).not.toBeCalled();
    });

    it('withdraws a retired key at the provider and takes its account out of the configuration', async () => {
        readUserData.mockImplementation((subject) =>
            subject === CONSOLE_SUBJECT
                ? [userRow(CONSOLE_SUBJECT, BUSINESS_ID, Environment.PRODUCTION)]
                : [userRow('liveKey@clients', BUSINESS_ID, Environment.PRODUCTION)],
        );

        const response = await keysService.remove({ keyId: 'liveKey', subject: CONSOLE_SUBJECT });

        expect(deleteClient).toBeCalledWith('liveKey', 'aToken');
        expect(loadPoints).toBeCalledTimes(1);
        expect(cacheManager.del).toBeCalledWith('liveKey@clients');
        expect(response.client_id).toEqual('liveKey');
        expect(rotateSecret).not.toBeCalled();
    });
});
