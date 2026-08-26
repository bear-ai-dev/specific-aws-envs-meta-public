import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { KeysService } from './keys.service.js';
import { EnvironmentService, UsersService } from './users.service.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { Environment } from './dto/Environment.js';
import { UserEntity } from './entities/user.entity.js';

describe('KeysService', () => {
    const businessID = 'myCoolCorp';
    const otherBusinessID = 'myCoolCorp-sandbox';
    const productionRows: Array<any> = [
        {
            subject: 'ingestKey@clients',
            businessID,
            environment: Environment.PRODUCTION,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
        {
            subject: 'reportsKey@clients',
            businessID,
            environment: Environment.PRODUCTION,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
        {
            // The person signed into the console is not a machine credential
            subject: 'auth0|aPerson',
            businessID,
            environment: Environment.PRODUCTION,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
    ];

    let keysService: KeysService;
    let usersService: UsersService;
    let mockReadAllUsersForBusiness: jest.Mock;
    let findClientSpy: jest.SpyInstance;
    let rotateSecretSpy: jest.SpyInstance;
    let deleteClientSpy: jest.SpyInstance;

    beforeEach(async () => {
        // Every account only ever sees the rows written against it, the account of an
        // environment being distinct from the account of the other environment.
        mockReadAllUsersForBusiness = jest.fn((account: string) => (account === businessID ? productionRows : []));
        const module: TestingModule = await Test.createTestingModule({
            providers: [KeysService],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return { readAllUsersForBusiness: mockReadAllUsersForBusiness };
                }
                if (token === UsersService) {
                    return {
                        findOne: jest.fn(() => ({
                            message: 'Found user',
                            data: [{ subject: 'auth0|aPerson', businessID, environment: Environment.PRODUCTION }],
                        })),
                        softDelete: jest.fn(() => ({ message: 'sucessfully removed user config' })),
                    };
                }
                if (token === EnvironmentService) {
                    return {
                        getCurrentEnvironment: jest.fn(() => ({
                            message: 'Found environment',
                            subject: 'auth0|aPerson',
                            environment: Environment.PRODUCTION,
                        })),
                    };
                }
            })
            .compile();

        keysService = module.get<KeysService>(KeysService);
        usersService = module.get<UsersService>(UsersService);

        jest.spyOn(OrganizationEntity, 'getAuth0ManagementToken').mockImplementation(async () => ({
            access_token: 'aManagementToken',
        }));
        findClientSpy = jest
            .spyOn(KeyEntity, 'findClient')
            .mockImplementation(async (keyId: string) => ({ client_id: keyId, name: `${keyId} name` }));
        rotateSecretSpy = jest
            .spyOn(KeyEntity, 'rotateSecret')
            .mockImplementation(async (keyId: string) => ({ client_id: keyId, client_secret: 'aFreshSecret' }));
        deleteClientSpy = jest.spyOn(KeyEntity, 'deleteClient').mockImplementation(async () => undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(keysService).toBeDefined();
    });

    it('lists only the machine credentials which the account holds', async () => {
        const { data } = await keysService.findAll({ subject: 'auth0|aPerson', businessID });
        expect(mockReadAllUsersForBusiness).toBeCalledWith(businessID);
        expect(data.map(({ keyId }) => keyId)).toEqual(['ingestKey', 'reportsKey']);
        expect(data.map(({ subject }) => subject)).toEqual(['ingestKey@clients', 'reportsKey@clients']);
        // A listing never carries a secret
        expect(data.some(({ client_secret }) => Boolean(client_secret))).toBe(false);
    });

    it('resolves the account of the caller when the request does not carry one', async () => {
        const { data } = await keysService.findAll({ subject: 'auth0|aPerson' });
        expect(usersService.findOne).toBeCalledWith({ subject: 'auth0|aPerson' });
        expect(data.length).toBe(2);
    });

    it('leaves out credentials the identity provider no longer holds', async () => {
        findClientSpy.mockImplementation(async (keyId: string) =>
            keyId === 'ingestKey' ? { client_id: keyId, name: 'ingest' } : null,
        );
        const { data } = await keysService.findAll({ subject: 'auth0|aPerson', businessID });
        expect(data.map(({ keyId }) => keyId)).toEqual(['ingestKey']);
    });

    it('rotates the secret of one credential and hands the new secret back', async () => {
        const response: any = await keysService.rotate({
            subject: 'auth0|aPerson',
            businessID,
            keyId: 'ingestKey',
        });
        expect(rotateSecretSpy).toBeCalledTimes(1);
        expect(rotateSecretSpy).toBeCalledWith('ingestKey', 'aManagementToken');
        expect(response.message).toBeDefined();
        expect(response.client_secret).toBe('aFreshSecret');
    });

    it('refuses to rotate a credential the account does not hold, leaving it untouched', async () => {
        await expect(
            keysService.rotate({ subject: 'auth0|aPerson', businessID, keyId: 'someoneElsesKey' }),
        ).rejects.toThrow(NotFoundException);
        expect(rotateSecretSpy).not.toBeCalled();
    });

    it('refuses to rotate a credential of the other environment of the account', async () => {
        await expect(
            keysService.rotate({ subject: 'auth0|aPerson', businessID: otherBusinessID, keyId: 'ingestKey' }),
        ).rejects.toThrow(NotFoundException);
        expect(mockReadAllUsersForBusiness).toBeCalledWith(otherBusinessID);
    });

    it('withdraws a retired credential and takes its subject out of the configuration', async () => {
        const { message } = await keysService.remove({
            subject: 'auth0|aPerson',
            businessID,
            keyId: 'reportsKey',
        });
        expect(message).toBeDefined();
        expect(deleteClientSpy).toBeCalledWith('reportsKey', 'aManagementToken');
        expect(usersService.softDelete).toBeCalledWith({
            subject: 'reportsKey@clients',
            businessID,
            environment: Environment.PRODUCTION,
        });
    });

    it('refuses to retire a credential the account does not hold, leaving it untouched', async () => {
        await expect(
            keysService.remove({ subject: 'auth0|aPerson', businessID, keyId: 'someoneElsesKey' }),
        ).rejects.toThrow(NotFoundException);
        expect(deleteClientSpy).not.toBeCalled();
        expect(usersService.softDelete).not.toBeCalled();
    });
});
