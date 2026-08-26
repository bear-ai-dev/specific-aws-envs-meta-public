import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { cache as cacheManager } from '../cacheStore.js';
import { Environment } from './dto/Environment.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { KeysService } from './keys.service.js';
import { UsersService } from './users.service.js';

jest.mock('../cacheStore');
const cacheMock = cacheManager;

describe('KeysService', () => {
    const businessID = 'myCoolCorp';
    const mockTag = jest.fn();
    const mockStringField = jest.fn();
    const mockLoadPoints = jest.fn();
    let mockFindAllUsersForBusinessID: jest.Mock;
    let mockFindOne: jest.Mock;
    let keysService: KeysService;

    beforeEach(async () => {
        mockFindAllUsersForBusinessID = jest.fn(async () => ({
            message: 'Found users',
            data: [
                // The person who signed in is not a key, and neither is a key of another environment.
                { subject: 'auth0|aPersonWhoSignedIn', businessID, environment: Environment.PRODUCTION },
                { subject: 'aKeyOfTheAccount@clients', businessID, environment: Environment.PRODUCTION },
                { subject: 'aKeyTheProviderLostTrackOf@clients', businessID, environment: Environment.PRODUCTION },
            ],
        }));
        mockFindOne = jest.fn(async () => ({ message: 'Found user', data: [{ businessID }] }));
        const module: TestingModule = await Test.createTestingModule({
            providers: [KeysService],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: mockTag, stringField: mockStringField }),
                    };
                }
                if (token === UsersService) {
                    return {
                        findAllUsersForBusinessID: mockFindAllUsersForBusinessID,
                        findOne: mockFindOne,
                    };
                }
            })
            .compile();
        keysService = module.get<KeysService>(KeysService);
        jest.spyOn(OrganizationEntity, 'getAuth0ManagementToken').mockImplementation(async () => ({
            access_token: 'aManagementToken',
        }));
        jest.spyOn(KeyEntity, 'listClients').mockImplementation(async () => {
            const clients = new Map();
            clients.set('aKeyOfTheAccount', { client_id: 'aKeyOfTheAccount', name: 'A key of the account' });
            clients.set('aKeyOfAnotherAccount', { client_id: 'aKeyOfAnotherAccount', name: 'Someone elses key' });
            return clients;
        });
        cacheMock.del = jest.fn();
    });
    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(keysService).toBeDefined();
    });

    it('lists only the keys the account holds', async () => {
        const { data } = await keysService.findAll({ subject: 'auth0|aPersonWhoSignedIn', businessID });
        expect(data.length).toBe(1);
        expect(data[0].keyId).toBe('aKeyOfTheAccount');
        expect(data[0].client_id).toBe('aKeyOfTheAccount');
        expect(data[0].name).toBe('A key of the account');
        expect(data[0].environment).toBe(Environment.PRODUCTION);
    });

    it('resolves the account of the caller when the request does not carry one', async () => {
        await keysService.findAll({ subject: 'auth0|aPersonWhoSignedIn' });
        expect(mockFindOne).toBeCalledWith({ subject: 'auth0|aPersonWhoSignedIn' });
        expect(mockFindAllUsersForBusinessID).toBeCalledWith({ businessID });
    });

    it('rotates the secret of a single key of the account', async () => {
        const rotate = jest.spyOn(KeyEntity, 'rotateSecret').mockImplementation(async () => ({
            client_id: 'aKeyOfTheAccount',
            name: 'A key of the account',
            client_secret: 'aFreshSecret',
        }));
        const response: any = await keysService.rotate({ businessID, keyId: 'aKeyOfTheAccount' });
        expect(rotate).toBeCalledTimes(1);
        expect(rotate).toBeCalledWith('aKeyOfTheAccount', 'aManagementToken');
        expect(response.client_secret).toBe('aFreshSecret');
        expect(response.clientSecret).toBe('aFreshSecret');
    });

    it('refuses a key which the account does not hold and leaves it as it was', async () => {
        const rotate = jest.spyOn(KeyEntity, 'rotateSecret');
        const remove = jest.spyOn(KeyEntity, 'deleteClient');
        await expect(keysService.rotate({ businessID, keyId: 'aKeyOfAnotherAccount' })).rejects.toThrow(
            NotFoundException,
        );
        await expect(keysService.remove({ businessID, keyId: 'aKeyOfAnotherAccount' })).rejects.toThrow(
            NotFoundException,
        );
        await expect(keysService.rotate({ businessID, keyId: 'aKeyTheProviderLostTrackOf' })).rejects.toThrow(
            NotFoundException,
        );
        expect(rotate).not.toBeCalled();
        expect(remove).not.toBeCalled();
        expect(mockLoadPoints).not.toBeCalled();
    });

    it('retires a key at the provider and takes its account out of the configuration', async () => {
        const remove = jest.spyOn(KeyEntity, 'deleteClient').mockImplementation(async () => undefined);
        const { message } = await keysService.remove({ businessID, keyId: 'aKeyOfTheAccount' });
        expect(message).toBeDefined();
        expect(remove).toBeCalledWith('aKeyOfTheAccount', 'aManagementToken');
        expect(mockLoadPoints).toBeCalledTimes(1);
        expect(mockTag).toBeCalledWith('softDelete', 'deleted');
        expect(mockTag).toBeCalledWith('subject', 'aKeyOfTheAccount@clients');
        // A caller still presenting the key must be refused from this moment, not once a cache expires.
        expect(cacheMock.del).toBeCalledWith('aKeyOfTheAccount@clients');
    });
});
