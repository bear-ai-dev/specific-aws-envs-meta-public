import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { NotFoundException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService, UsersService } from './users.service.js';
import { KeysService } from './keys.service.js';
import { KeyEntity } from './entities/key.entity.js';
import { OrganizationEntity } from './entities/organization.entity.js';
import { Environment } from './dto/Environment.js';
import { UserEntity } from './entities/user.entity.js';
import { EnvironmentEntity } from './entities/environment.entity.js';
import { cache as cacheManager } from '../cacheStore.js';

jest.mock('../cacheStore');
const cacheMock = cacheManager;

describe('KeysService', () => {
    const businessID = 'myCoolCorp';
    const row = (subject: string, environment: Environment, business = businessID) => ({
        subject,
        businessID: business,
        environment,
        _field: 'userStatus',
        _value: 'live',
        _measurement: UserEntity._measurementActiveEnvironment,
        _time: new Date().toISOString(),
    });

    let mockReadAllUsersForBusiness: jest.Mock;
    let mockReadEnvironmentForBusiness: jest.Mock;
    let mockLoadPoints: jest.Mock;
    let keysService: KeysService;
    let usersService: UsersService;

    beforeEach(async () => {
        mockReadAllUsersForBusiness = jest.fn(() => [
            row('myKeyOne@clients', Environment.PRODUCTION),
            row('myKeyTwo@clients', Environment.PRODUCTION),
            row('auth0|aPersonWhoSignedIn', Environment.PRODUCTION),
        ]);
        mockReadEnvironmentForBusiness = jest.fn(() => [row('myKeyOne@clients', Environment.PRODUCTION)]);
        mockLoadPoints = jest.fn();

        const module: TestingModule = await Test.createTestingModule({
            providers: [KeysService, UsersService, EnvironmentService],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: jest.fn(), stringField: jest.fn() }),
                        readAllUsersForBusiness: mockReadAllUsersForBusiness,
                        readEnvironmentForBusiness: mockReadEnvironmentForBusiness,
                        readCurrentUserEnv: jest.fn(() => [
                            {
                                subject: 'auth0|aPersonWhoSignedIn',
                                _value: Environment.PRODUCTION,
                                _field: 'environment',
                                _measurement: EnvironmentEntity._measurement,
                                _time: new Date().toISOString(),
                            },
                        ]),
                    };
                }
            })
            .compile();

        keysService = module.get<KeysService>(KeysService);
        usersService = module.get<UsersService>(UsersService);
        cacheMock.get = jest.fn();
        cacheMock.set = jest.fn();
        cacheMock.del = jest.fn();

        jest.spyOn(OrganizationEntity, 'getAuth0ManagementToken').mockResolvedValue({ access_token: 'aToken' });
        jest.spyOn(KeyEntity, 'findClient').mockImplementation(async (clientId: string) => ({
            client_id: clientId,
            name: `name of ${clientId}`,
        }));
        jest.spyOn(KeyEntity, 'rotateSecret').mockImplementation(async (clientId: string) => ({
            client_id: clientId,
            client_secret: `aFreshSecretFor-${clientId}`,
        }));
        jest.spyOn(KeyEntity, 'deleteClient').mockResolvedValue(true);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(keysService).toBeDefined();
    });

    it('lists only the machine credentials of the account', async () => {
        const { data } = await keysService.findAll({ businessID, subject: 'auth0|aPersonWhoSignedIn' });
        expect(data.map((key) => key.client_id)).toEqual(['myKeyOne', 'myKeyTwo']);
        expect(data[0].name).toBe('name of myKeyOne');
        expect(data[0].environment).toBe(Environment.PRODUCTION);
    });

    it('does not list the credentials of another environment of the account', async () => {
        mockReadAllUsersForBusiness.mockImplementation(() => [
            row('myKeyOne@clients', Environment.PRODUCTION),
            row('mySandboxKey@clients', Environment.SANDBOX),
        ]);
        const { data } = await keysService.findAll({ businessID, subject: 'auth0|aPersonWhoSignedIn' });
        expect(data.map((key) => key.client_id)).toEqual(['myKeyOne']);
    });

    it('rotates the secret of the named key only', async () => {
        const response = await keysService.rotate({
            businessID,
            subject: 'auth0|aPersonWhoSignedIn',
            keyId: 'myKeyTwo',
        });
        expect(KeyEntity.rotateSecret).toBeCalledTimes(1);
        expect(KeyEntity.rotateSecret).toBeCalledWith('myKeyTwo', 'aToken');
        expect(response.client_secret).toBe('aFreshSecretFor-myKeyTwo');
        expect(response.client_id).toBe('myKeyTwo');
        expect(KeyEntity.deleteClient).not.toBeCalled();
    });

    it('retires a key at the identity provider and in the configuration', async () => {
        const softDelete = jest.spyOn(usersService, 'softDelete');
        const response = await keysService.remove({
            businessID,
            subject: 'auth0|aPersonWhoSignedIn',
            keyId: 'myKeyOne',
        });
        expect(KeyEntity.deleteClient).toBeCalledWith('myKeyOne', 'aToken');
        expect(softDelete).toBeCalledWith({
            subject: 'myKeyOne@clients',
            businessID,
            environment: Environment.PRODUCTION,
        });
        expect(response.client_id).toBe('myKeyOne');
    });

    it.each(['aKeyOfAnotherTenant', 'mySandboxKey', 'somethingTheTenantNeverClaimed'])(
        'refuses %s and leaves it exactly as it was',
        async (keyId) => {
            mockReadAllUsersForBusiness.mockImplementation(() => [
                row('myKeyOne@clients', Environment.PRODUCTION),
                row('mySandboxKey@clients', Environment.SANDBOX),
            ]);
            await expect(
                keysService.rotate({ businessID, subject: 'auth0|aPersonWhoSignedIn', keyId }),
            ).rejects.toThrow(NotFoundException);
            await expect(
                keysService.remove({ businessID, subject: 'auth0|aPersonWhoSignedIn', keyId }),
            ).rejects.toThrow(NotFoundException);
            expect(KeyEntity.rotateSecret).not.toBeCalled();
            expect(KeyEntity.deleteClient).not.toBeCalled();
            expect(mockLoadPoints).not.toBeCalled();
        },
    );
});
