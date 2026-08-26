import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { UserTable } from '../influx/entities/userTable.entity.js';
import { cache as cacheManager } from '../cacheStore.js';
import { Environment } from './dto/Environment.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { KeysService } from './keys.service.js';
import { EnvironmentService, UsersService } from './users.service.js';

jest.mock('../cacheStore');
const cacheMock = cacheManager;

describe('KeysService', () => {
    const businessID = 'myCoolCorp';
    const subject = 'auth0|testtesttest';
    const productionRows: Array<UserTable> = [
        {
            subject,
            businessID,
            environment: Environment.PRODUCTION,
            _value: 'live',
            _field: 'userStatus',
            _measurement: UserEntity._measurement,
            _time: new Date().toISOString(),
            accountExpiryDate: undefined,
            temp: false,
        },
        {
            subject: 'myFirstKey@clients',
            businessID,
            environment: Environment.PRODUCTION,
            _value: 'live',
            _field: 'userStatus',
            _measurement: UserEntity._measurement,
            _time: new Date().toISOString(),
            accountExpiryDate: undefined,
            temp: false,
        },
        {
            subject: 'mySecondKey@clients',
            businessID,
            environment: Environment.PRODUCTION,
            _value: 'live',
            _field: 'userStatus',
            _measurement: UserEntity._measurement,
            _time: new Date().toISOString(),
            accountExpiryDate: undefined,
            temp: false,
        },
    ];
    const mockLoadPoints = jest.fn();
    const mockTag = jest.fn();
    let mockReadAllUsersForBusiness: jest.Mock;
    let keysService: KeysService;

    beforeEach(async () => {
        mockReadAllUsersForBusiness = jest.fn(() => productionRows);
        const module: TestingModule = await Test.createTestingModule({
            providers: [KeysService, UsersService, EnvironmentService],
            imports: [],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: mockTag, stringField: jest.fn() }),
                        readAllUsersForBusiness: mockReadAllUsersForBusiness,
                        readCurrentUserEnv: jest.fn(() => []),
                        readUserData: jest.fn(() => productionRows),
                    };
                }
            })
            .compile();
        keysService = module.get<KeysService>(KeysService);
        cacheMock.get = jest.fn();
        cacheMock.set = jest.fn();
        cacheMock.del = jest.fn();
        jest.spyOn(OrganizationEntity, 'getAuth0ManagementToken').mockResolvedValue({ access_token: 'token' });
        jest.spyOn(KeyEntity, 'listClients').mockResolvedValue([
            { client_id: 'myFirstKey', name: 'My first key' },
            { client_id: 'mySecondKey', name: 'My second key' },
            { client_id: 'someoneElsesKey', name: 'Someone elses key' },
        ]);
        jest.spyOn(KeyEntity, 'rotateClientSecret').mockResolvedValue({ client_secret: 'aNewSecret' });
        jest.spyOn(KeyEntity, 'deleteClient').mockResolvedValue(undefined);
    });
    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    it('should be defined', () => {
        expect(keysService).toBeDefined();
    });

    it('only returns the machine credentials which the account holds', async () => {
        const { data } = await keysService.findAll({ businessID, subject });
        expect(data.map(({ keyId }) => keyId)).toEqual(['myFirstKey', 'mySecondKey']);
        expect(data.map(({ name }) => name)).toEqual(['My first key', 'My second key']);
        expect(data.every(({ client_secret }) => client_secret === undefined)).toBe(true);
    });

    it('rotates the secret of a single credential of the account', async () => {
        const response = await keysService.rotateSecret({ businessID, subject, keyId: 'myFirstKey' });
        expect(KeyEntity.rotateClientSecret).toBeCalledTimes(1);
        expect(KeyEntity.rotateClientSecret).toBeCalledWith('myFirstKey', 'token');
        expect(response.client_secret).toBe('aNewSecret');
        expect(response.data[0].keyId).toBe('myFirstKey');
        // rotating a secret never alters the configuration of the account
        expect(mockLoadPoints).not.toBeCalled();
    });

    it('refuses to rotate a credential which the account does not hold', async () => {
        await expect(keysService.rotateSecret({ businessID, subject, keyId: 'someoneElsesKey' })).rejects.toThrow(
            NotFoundException,
        );
        expect(KeyEntity.rotateClientSecret).not.toBeCalled();
    });

    it('refuses to delete a credential which the account does not hold', async () => {
        await expect(keysService.remove({ businessID, subject, keyId: 'someoneElsesKey' })).rejects.toThrow(
            NotFoundException,
        );
        expect(KeyEntity.deleteClient).not.toBeCalled();
        expect(mockLoadPoints).not.toBeCalled();
    });

    it('withdraws a retired credential and removes it from the accounts configuration', async () => {
        const { message } = await keysService.remove({ businessID, subject, keyId: 'mySecondKey' });
        expect(message).toBeDefined();
        expect(KeyEntity.deleteClient).toBeCalledWith('mySecondKey', 'token');
        expect(mockLoadPoints).toBeCalledTimes(1);
        expect(mockTag).toBeCalledWith('softDelete', 'deleted');
        expect(mockTag).toBeCalledWith('subject', 'mySecondKey@clients');
        // the credential must be refused from this moment onwards, not once a cache expires
        expect(cacheMock.del).toBeCalledWith('mySecondKey@clients');
    });
});
