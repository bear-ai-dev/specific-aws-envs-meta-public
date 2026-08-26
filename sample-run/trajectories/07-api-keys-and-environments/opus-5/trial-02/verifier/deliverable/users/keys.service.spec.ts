import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Environment } from './dto/Environment.js';
import { KeyEntity } from './entities/keys.entity.js';
import { KeysService } from './keys.service.js';
import { UserEntity } from './entities/user.entity.js';

describe('KeysService', () => {
    const businessID = 'harborline';
    const productionRows = [
        {
            subject: 'keyProdIngest@clients',
            businessID,
            environment: Environment.PRODUCTION,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
        {
            subject: 'keyProdRemovedFromIdentityProvider@clients',
            businessID,
            environment: Environment.PRODUCTION,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
        {
            // A person signed in to the console is not a machine credential
            subject: 'auth0|operator',
            businessID,
            environment: Environment.PRODUCTION,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
    ];

    let readAllUsersForBusiness: jest.Mock;
    let revoke: jest.Mock;
    let keysService: KeysService;

    beforeEach(() => {
        readAllUsersForBusiness = jest.fn(async () => productionRows);
        revoke = jest.fn(async () => ({ message: 'sucessfully removed user config' }));
        keysService = new KeysService({ readAllUsersForBusiness } as any, { revoke } as any);
        jest.spyOn(KeyEntity, 'getManagementToken').mockResolvedValue('management-token');
        jest.spyOn(KeyEntity, 'listClients').mockResolvedValue([
            { client_id: 'keyProdIngest', name: 'Production ingest' },
            // Something the identity provider knows about which this account never claimed
            { client_id: 'keySomebodyElse', name: 'Another tenant' },
        ]);
        jest.spyOn(KeyEntity, 'findClient').mockImplementation(async (clientId: string) =>
            clientId === 'keyProdIngest' ? { client_id: clientId, name: 'Production ingest' } : undefined,
        );
        jest.spyOn(KeyEntity, 'rotateSecret').mockResolvedValue({
            client_id: 'keyProdIngest',
            name: 'Production ingest',
            client_secret: 'a-brand-new-secret',
        });
        jest.spyOn(KeyEntity, 'deleteClient').mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.clearAllMocks();
    });

    it('should list only the machine credentials the account holds', async () => {
        const { data, total } = await keysService.findAll({ businessID });
        expect(total).toBe(1);
        expect(data.map(({ client_id }) => client_id)).toEqual(['keyProdIngest']);
        expect(data[0].name).toBe('Production ingest');
        expect(data[0].subject).toBe('keyProdIngest@clients');
        expect(JSON.stringify(data)).not.toContain('secret');
    });

    it('should refuse to list keys when no account was resolved for the request', async () => {
        await expect(keysService.findAll({ businessID: undefined })).rejects.toThrow(UnauthorizedException);
    });

    it('should rotate the secret of a key the account holds', async () => {
        const response: any = await keysService.rotate({ businessID, keyId: 'keyProdIngest' });
        expect(KeyEntity.rotateSecret).toBeCalledTimes(1);
        expect(KeyEntity.rotateSecret).toBeCalledWith('keyProdIngest', 'management-token');
        expect(response.client_secret).toBe('a-brand-new-secret');
    });

    it('should accept a key named by the subject it signs in as', async () => {
        await keysService.rotate({ businessID, keyId: 'keyProdIngest@clients' });
        expect(KeyEntity.rotateSecret).toBeCalledWith('keyProdIngest', 'management-token');
    });

    it('should refuse a key the account does not hold, and leave it exactly as it was', async () => {
        await expect(keysService.rotate({ businessID, keyId: 'keySomebodyElse' })).rejects.toThrow(NotFoundException);
        await expect(keysService.remove({ businessID, keyId: 'keySomebodyElse' })).rejects.toThrow(NotFoundException);
        expect(KeyEntity.rotateSecret).not.toBeCalled();
        expect(KeyEntity.deleteClient).not.toBeCalled();
        expect(revoke).not.toBeCalled();
    });

    it('should refuse a key the identity provider no longer holds', async () => {
        await expect(keysService.rotate({ businessID, keyId: 'keyProdRemovedFromIdentityProvider' })).rejects.toThrow(
            NotFoundException,
        );
        expect(KeyEntity.rotateSecret).not.toBeCalled();
    });

    it('should withdraw the credential and take its account out of the configuration', async () => {
        const response = await keysService.remove({ businessID, keyId: 'keyProdIngest' });
        expect(KeyEntity.deleteClient).toBeCalledWith('keyProdIngest', 'management-token');
        expect(revoke).toBeCalledWith({
            subject: 'keyProdIngest@clients',
            businessID,
            environment: Environment.PRODUCTION,
        });
        expect(response.message).toContain('keyProdIngest');
    });
});
