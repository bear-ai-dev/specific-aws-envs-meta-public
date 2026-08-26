import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InfluxService } from '../influx/influx.service.js';
import { Environment } from '../users/dto/Environment.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { EnvironmentService, UsersService } from '../users/users.service.js';
import { KeyEntity } from './entities/key.entity.js';
import { KeysService } from './keys.service.js';

describe('KeysService', () => {
    const businessID = 'myCoolCorp';
    const subject = 'auth0|testtesttest';

    const productionRow = (keySubject: string) => ({
        subject: keySubject,
        businessID,
        environment: Environment.PRODUCTION,
        _field: 'userStatus',
        _value: 'live',
        _measurement: 'UserDataEnv',
        _time: new Date().toISOString(),
    });

    let keysService: KeysService;
    let mockReadAllUsersForBusiness: jest.Mock;
    let mockReadUserData: jest.Mock;
    let mockSoftDelete: jest.Mock;
    let mockRotateSecret: jest.SpyInstance;
    let mockDeleteClient: jest.SpyInstance;

    beforeEach(async () => {
        mockReadAllUsersForBusiness = jest.fn(async () => [
            productionRow(`${subject}`),
            productionRow('keyProductionIngest@clients'),
        ]);
        mockReadUserData = jest.fn(async (requestedSubject: string) =>
            requestedSubject === 'keyProductionIngest@clients' ? [productionRow(requestedSubject)] : [],
        );
        mockSoftDelete = jest.fn(async () => ({ message: 'deleted' }));

        jest.spyOn(OrganizationEntity, 'getAuth0ManagementToken').mockResolvedValue({ access_token: 'token' });
        jest.spyOn(KeyEntity, 'listClients').mockResolvedValue([
            { client_id: 'keyProductionIngest', name: 'Production ingest' },
        ]);
        mockRotateSecret = jest
            .spyOn(KeyEntity, 'rotateSecret')
            .mockResolvedValue({ client_id: 'keyProductionIngest', client_secret: 'freshSecret' });
        mockDeleteClient = jest.spyOn(KeyEntity, 'deleteClient').mockResolvedValue(undefined);

        const module: TestingModule = await Test.createTestingModule({
            providers: [KeysService],
        })
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        readAllUsersForBusiness: mockReadAllUsersForBusiness,
                        readUserData: mockReadUserData,
                        loadPoints: jest.fn(),
                        getPoint: () => ({ tag: jest.fn(), stringField: jest.fn() }),
                    };
                }
                if (token === UsersService) {
                    return {
                        findOne: jest.fn(async () => ({
                            message: 'Found user',
                            data: [{ subject, businessID, environment: Environment.PRODUCTION }],
                        })),
                        softDelete: mockSoftDelete,
                    };
                }
                if (token === EnvironmentService) {
                    return {
                        getCurrentEnvironment: jest.fn(async () => ({
                            message: 'Found environment',
                            subject,
                            environment: Environment.PRODUCTION,
                        })),
                    };
                }
            })
            .compile();

        keysService = module.get<KeysService>(KeysService);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('should only list the machine credentials of the account', async () => {
        const { data } = await keysService.findAll({ subject });
        expect(data).toHaveLength(1);
        expect(data[0].keyId).toBe('keyProductionIngest');
        expect(data[0].name).toBe('Production ingest');
        expect(JSON.stringify(data)).not.toContain('Secret');
    });

    it('should rotate the secret of a key the account holds', async () => {
        const response = await keysService.rotate({ subject, keyId: 'keyProductionIngest' });
        expect(mockRotateSecret).toBeCalledTimes(1);
        expect(response.client_secret).toBe('freshSecret');
    });

    it('should refuse to rotate a key the account does not hold, and leave it alone', async () => {
        await expect(keysService.rotate({ subject, keyId: 'keySomeoneElsesIngest' })).rejects.toThrow(
            NotFoundException,
        );
        expect(mockRotateSecret).not.toBeCalled();
    });

    it('should withdraw a deleted key at the identity provider and out of the configuration', async () => {
        await keysService.remove({ subject, keyId: 'keyProductionIngest' });
        expect(mockDeleteClient).toBeCalledWith('keyProductionIngest', 'token');
        expect(mockSoftDelete).toBeCalledWith({
            subject: 'keyProductionIngest@clients',
            businessID,
            environment: Environment.PRODUCTION,
        });
    });

    it('should refuse to delete a key the account does not hold, and leave it alone', async () => {
        await expect(keysService.remove({ subject, keyId: 'keySomeoneElsesIngest' })).rejects.toThrow(
            NotFoundException,
        );
        expect(mockDeleteClient).not.toBeCalled();
        expect(mockSoftDelete).not.toBeCalled();
    });
});
