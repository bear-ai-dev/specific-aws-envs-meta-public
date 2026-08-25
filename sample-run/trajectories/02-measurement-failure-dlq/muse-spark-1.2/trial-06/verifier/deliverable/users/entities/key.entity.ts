import { InternalServerErrorException, Logger } from '@nestjs/common';
import { UsersService } from '../users.service.js';

import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { cache } from '../../cacheStore.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { UserEntity } from './user.entity.js';
import { serializeError } from 'serialize-error';
import { UserPermissions } from '../user.permissions.js';
const TWENTY_SECONDS = 20000;
const MS_CONVERSION_FACTOR = 1000;

export class KeyEntity {
    private static readonly logger = new Logger(KeyEntity.name);
    clientId: string;
    clientName: string;
    permissions?: any;
    constructor({ clientId, clientName }: { clientId: string; clientName: string }) {
        this.clientId = clientId;
        this.clientName = clientName;
    }
    static async getAuth0ManagementToken() {
        const token = (await cache.get('auth0ManagementTokenTokenService')) as any;
        let parsedToken;
        if (token) {
            try {
                parsedToken = JSON.parse(token);
            } catch (e) {
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Error parsing auth0ManagementToken for Token Service',
                    data: [e],
                });
            }
        }
        if (
            parsedToken &&
            parsedToken?.expireTime &&
            new Date(parsedToken.expireTime).getTime() > Date.now() + TWENTY_SECONDS &&
            parsedToken?.access_token
        ) {
            return { access_token: parsedToken?.access_token };
        } else {
            const res = await fetch('https://auth.meteringco.example/oauth/token/', {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    client_id: process.env.METERINGCO_DASHBOARD_CLIENT_ID,
                    client_secret: process.env.METERINGCO_DASHBOARD_CLIENT_SECRET,
                    audience: 'https://example-tenant.us.auth0.com/api/v2/',
                    grant_type: 'client_credentials',
                    scope: 'read:clients read:client_keys read:client_credentials delete:client_keys delete:client_credentials update:clients create:clients update:client_keys update:client_credentials create:client_keys create:client_credentials',
                }),
            });
            KeyEntity.logger.log('Fetching new auth0ManagementToken for Token Service');
            if (!res.ok) {
                throw new InternalServerErrorException('Error fetching auth0ManagementToken for Token Service');
            }
            KeyEntity.logger.debug(res.status, res.statusText);
            const jsonRes = await res.json();

            const { expires_in, access_token } = jsonRes;
            const expireTime = new Date(Date.now() + expires_in * MS_CONVERSION_FACTOR);
            cache.set('auth0ManagementTokenTokenService', JSON.stringify({ access_token, expireTime }));
            return { access_token };
        }
    }
    static async findClientsForBusiness({
        businessID,
        usersService,
    }: {
        businessID: string;
        usersService?: UsersService;
    }): Promise<KeyEntity[]> {
        const { access_token: accessToken } = await KeyEntity.getAuth0ManagementToken();
        KeyEntity.logger.log(`Fetching clients for business: ${businessID}`);
        const clients = [];
        let start;
        let limit;
        let total;
        let page = 0;
        do {
            const res = await fetch(
                `https://auth.meteringco.example/api/v2/clients?fields=client_secret%2Cclient_authentication_methods%2Csigning_keys&include_fields=false&per_page=50&page=${page}&include_totals=true`,
                {
                    method: 'GET',
                    headers: {
                        'content-type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                        'cache-control': 'no-cache',
                    },
                },
            );
            const jsonRes = await res.json();
            KeyEntity.logger.debug(
                `Fetched clients for business: ${businessID} page: ${page}. Status: ${res.status} ${res.statusText}`,
            );
            start = jsonRes?.start;
            limit = jsonRes?.limit;
            total = jsonRes?.total;
            if (start === undefined || limit === undefined || total === undefined) {
                KeyEntity.logger.error(
                    `Error occured while pagination of Token response: Start: ${start} Limit: ${limit}  Total: ${total}`,
                );
                throw new InternalServerErrorException('Failed to get clients, please try again later');
            }
            clients.push(...jsonRes?.clients);
            page++;
        } while (start + limit < total);
        KeyEntity.logger.debug(`Fetched clients for business: ${businessID}. Total clients: ${clients.length}.`);
        if (clients && clients.length) {
            const { data: users } = await usersService.findAllUsersForBusinessID({ businessID });
            const usersMap = users.reduce((acc, user): Record<string, UserEntity> => {
                if (user.subject.split('@')[1] === 'clients') {
                    acc[user.subject] = user;
                }
                return acc;
            }, {});
            return clients.reduce((acc, { client_id, ...rest }): KeyEntity[] => {
                const user = usersMap[`${client_id}@clients`];
                if (user) {
                    acc.push(new KeyEntity({ clientId: client_id, clientName: rest.name }));
                }
                return acc;
            }, []);
        } else {
            throw new InternalServerErrorException('Failed to get clients, please try again later');
        }
    }

    static async rotateClientSecret({ clientId }): Promise<any> {
        KeyEntity.logger.log(`Rotating client secret for client: ${clientId}`);
        const { access_token: accessToken } = await KeyEntity.getAuth0ManagementToken();
        try {
            const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${clientId}/rotate-secret`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'cache-control': 'no-cache',
                },
            });
            return res;
        } catch (e) {
            KeyEntity.logger.error(`Error rotating client secret for client: ${clientId}`);
            KeyEntity.logger.error(serializeError(e));
            AuditService.publishEvent({
                message: 'Error rotating client secret for client',
                topic: AuditScope.ERROR,
                data: [serializeError(e)],
            });
            throw new InternalServerErrorException('Failed to rotate client secret, please try again later');
        }
    }

    static async deleteClient({ clientId }): Promise<any> {
        KeyEntity.logger.log(`Deleting client: ${clientId}`);
        const { access_token: accessToken } = await KeyEntity.getAuth0ManagementToken();
        try {
            const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${clientId}`, {
                method: 'DELETE',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'cache-control': 'no-cache',
                },
            });
            return res;
        } catch (e) {
            KeyEntity.logger.error(`Error Deleting key: ${clientId}`);
            KeyEntity.logger.error(serializeError(e));
            AuditService.publishEvent({
                message: 'Error Deleting key',
                topic: AuditScope.ERROR,
                data: [serializeError(e)],
            });
            throw new InternalServerErrorException('Failed to delete key, please try again later');
        }
    }

    static async getPermissionsForClient({ clientId }): Promise<any> {
        KeyEntity.logger.log(`Fetching permissions for client: ${clientId}`);
        const { access_token: accessToken } = await KeyEntity.getAuth0ManagementToken();
        try {
            const res = await fetch(`https://auth.meteringco.example/api/v2/users/${clientId}/permissions`, {
                method: 'GET',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'cache-control': 'no-cache',
                },
            });
            const jsonRes = await res.json();
            KeyEntity.logger.debug(
                `Fetched permissions for client: ${clientId}. Status: ${res.status} ${res.statusText}`,
            );
            return jsonRes;
        } catch (e) {
            KeyEntity.logger.error(`Error fetching permissions for client: ${clientId}`);
            KeyEntity.logger.error(serializeError(e));
            AuditService.publishEvent({
                message: 'Error fetching permissions for client',
                topic: AuditScope.ERROR,
                data: [serializeError(e)],
            });
            throw new InternalServerErrorException('Failed to fetch permissions, please try again later');
        }
    }

    static async updatePermissionsForUser({
        subject,
        businessID,
        accessToken,
    }: {
        subject: string;
        businessID: string;
        accessToken: string;
    }): Promise<any> {
        await UserEntity.updateUserPermissions(new UserEntity({ subject, businessID }), accessToken, [
            UserPermissions.KEYSREAD,
            UserPermissions.KEYSDELETE,
            UserPermissions.KEYSUPDATE,
        ]);
    }
}
