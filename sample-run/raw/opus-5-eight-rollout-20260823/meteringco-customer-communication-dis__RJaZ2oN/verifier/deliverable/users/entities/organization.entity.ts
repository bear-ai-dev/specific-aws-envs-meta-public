import { Point } from '@influxdata/influxdb-client';
import { BadRequestException, Logger, NotFoundException } from '@nestjs/common';
import { fetch } from 'cross-fetch';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

import { InfluxService } from '../../influx/influx.service.js';
import { CreateOrganizationDto } from '../dto/create-organization.dto.js';
import { UsersService } from '../users.service.js';
import { Environment } from '../dto/Environment.js';
import { cache as cacheManager } from '../../cacheStore.js';

const TWENTY_SECONDS = 20000;
const MS_CONVERSION_FACTOR = 1000;
export const enum OrganizationStatus {
    LIVE = 'live',
}
export class OrganizationEntity {
    private static readonly logger = new Logger(OrganizationEntity.name);
    public static _measurement = 'organizations';
    public businessID: string;
    public organizationDisplayName: string;
    public subjects: string[];
    public emails: string[];
    public organizationStatus: string;
    public orgId: string;

    constructor(
        createOrganizationDto: CreateOrganizationDto,
        organizationStatus?: OrganizationStatus,
        orgId?: string,
        emails?: string[],
    ) {
        this.businessID = createOrganizationDto.businessID;
        this.organizationDisplayName = createOrganizationDto.organizationDisplayName;
        this.subjects = createOrganizationDto.subjects;
        this.organizationStatus = organizationStatus;
        this.orgId = orgId;
        this.emails = emails;
    }

    public static transformer(organizationEntity: OrganizationEntity, influxService: InfluxService): Point[] {
        const organizationPoint = influxService.getPoint(OrganizationEntity._measurement);
        organizationPoint.tag('organizationDisplayName', organizationEntity.organizationDisplayName);
        organizationPoint.tag('businessID', organizationEntity.businessID);
        organizationPoint.tag('orgId', organizationEntity.orgId);

        organizationPoint.stringField('organizationStatus', OrganizationStatus.LIVE);

        return [organizationPoint];
    }

    public static dbModelToEntity(dbModel) {
        if (dbModel.length > 1) {
            throw new Error('Invalid Organization model Information, check DB');
        }
        const [{ businessID, organizationDisplayName, subject, _value, orgId }] = dbModel;
        return new OrganizationEntity({ businessID, organizationDisplayName, subjects: subject }, _value, orgId);
    }

    public static async createAuth0Organization(
        organizationEntity: OrganizationEntity,
        accessToken: string,
    ): Promise<{ id: string }> {
        const data = JSON.stringify({
            name: organizationEntity.businessID.toLowerCase(),
            display_name: organizationEntity.organizationDisplayName,
            // TODO Figure out what the connections are and if we need them
            enabled_connections: [{ connection_id: 'con_MJwaDIMnFxFOHS3v', assign_membership_on_login: false }],
        });
        const res = await fetch('https://auth.meteringco.example/api/v2/organizations', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
            body: data,
        });

        const jsonRes = await res.json();
        if (jsonRes?.error) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Error creating auth0 organization',
                data: [jsonRes],
            });
            throw new Error('Error creating auth0 organization');
        }
        if (!jsonRes?.id) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Error creating auth0 organization',
                data: [jsonRes],
            });
            throw new Error('Error creating auth0 organization');
        }
        return jsonRes;
    }

    public static async assignUserToOrganization(
        organizationEntity: OrganizationEntity,
        accessToken: string,
        subject: string,
    ) {
        const data = JSON.stringify({
            members: [subject],
        });
        const res = await fetch(`https://auth.meteringco.example/api/v2/organizations/${organizationEntity?.orgId}/members`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
            body: data,
        });
        OrganizationEntity.logger.debug(JSON.stringify(res.status), 'assignUserToOrganization');

        if (!res?.ok) {
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Error creating auth0 organization',
                data: [res.body, res.headers],
            });
            throw new Error('Error creating auth0 organization');
        }
        return { status: res.status, body: res.body, headers: res.headers };
    }

    public static async getAuth0ManagementToken(cache): Promise<{ access_token: string }> {
        const token = await cache.get('auth0ManagementToken');
        let parsedToken;
        if (token) {
            try {
                parsedToken = JSON.parse(token);
            } catch (e) {
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: 'Error parsing auth0ManagementToken',
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
                    scope: 'create:organizations read:organizations update:organizations delete:organizations create:organization_members read:organization_members delete:organization_members update:users create:users create:user_tickets read:user_idp_tokens read:users',
                }),
            });

            const jsonRes = await res.json();

            const { expires_in, access_token } = jsonRes;
            const expireTime = new Date(Date.now() + expires_in * MS_CONVERSION_FACTOR);
            cache.set('auth0ManagementToken', JSON.stringify({ access_token, expireTime }));
            return { access_token };
        }
    }

    public static async validateOrganizationDoesntExist(businessID, accessToken) {
        try {
            const res = await fetch(`https://auth.meteringco.example/api/v2/organizations/name/${businessID.toLowerCase()}`, {
                method: 'GET',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'cache-control': 'no-cache',
                },
            });
            const jsonRes = await res.json();
            if (jsonRes.statusCode === 404) {
                return;
            } else {
                OrganizationEntity.logger.debug(jsonRes);
                throw new BadRequestException('Organization already exists');
            }
        } catch (e) {
            if (e.status === 400) {
                OrganizationEntity.logger.debug(e);
                throw new BadRequestException('Organization already exists');
            }
            if (e.status === 404) {
                return;
            } else {
                AuditService.publishEvent({
                    topic: AuditScope.ERROR,
                    message: "Error validating organization doesn't exist",
                    data: [e],
                });
                throw new BadRequestException("Error validating organization doesn't exist");
            }
        }
    }

    public static async findOrganizationByBusinessID(
        businessID: string,
        accessToken: string,
    ): Promise<OrganizationEntity> {
        const res = await fetch(`https://auth.meteringco.example/api/v2/organizations/name/${businessID.toLowerCase()}`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        const jsonRes = await res.json();
        if (jsonRes?.statusCode === 404) {
            throw new NotFoundException('Organization not found');
        }
        const { display_name, id } = jsonRes;
        const members = await fetch(`https://auth.meteringco.example/api/v2/organizations/${id}/members`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });
        const membersJson = await members.json();

        return new OrganizationEntity(
            {
                organizationDisplayName: display_name,
                businessID,
                subjects: membersJson.map(({ user_id }) => user_id),
            },
            OrganizationStatus.LIVE,
            id,
            membersJson.map(({ email }) => email),
        );
    }
    public static async getCountOfOrganizationMembers({
        businessID,
    }: {
        businessID: string;
    }): Promise<[{ _value: number | null }]> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        try {
            const orgEntity = await OrganizationEntity.findOrganizationByBusinessID(businessID, access_token);
            return [{ _value: orgEntity.subjects.length }];
        } catch (e) {
            if (e.status === 404) {
                return [{ _value: null }];
            } else {
                throw e;
            }
        }
    }

    public static async handleErrors(res: Response, message: string, functionName: string) {
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message,
            data: [res.body, res.headers],
        });
        throw new Error(message);
    }

    public static async addUserToOrganization(
        organizationEntity: OrganizationEntity,
        accessToken: string,
        email: string,
        businessID: string,
        usersService: UsersService,
    ): Promise<{ userId: string }> {
        // Determine if the user already exists in auth0 and if so, get their user_id
        // If the user doesn't exist, create them and get their user_id
        // The creation process will send an email to the user to create their account hopefully...

        const res = await fetch(`https://auth.meteringco.example/api/v2/users-by-email?email=${encodeURIComponent(email)}`, {
            method: 'GET',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                'cache-control': 'no-cache',
            },
        });

        OrganizationEntity.logger.debug(JSON.stringify(res.status), 'findUserByEmail');

        if (!res?.ok) {
            let jsonResponse;
            try {
                jsonResponse = await res.json();
            } catch (e) {
                OrganizationEntity.logger.debug(e, 'findUserByEmail');
            }
            OrganizationEntity.logger.debug(jsonResponse, 'findUserByEmail');
            await OrganizationEntity.handleErrors(
                jsonResponse ? jsonResponse : res,
                `Error finding user email: ${email}`,
                'addUserToOrganization',
            );
        }

        const textBlob = await res.text();
        const data = JSON.parse(textBlob);

        if (data.length === 0) {
            const res = await fetch(`https://auth.meteringco.example/api/v2/users`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${accessToken}`,
                    'cache-control': 'no-cache',
                },
                body: JSON.stringify({
                    email,
                    password: '#tempMeteringCo1',
                    connection: 'Username-Password-Authentication',
                }),
            });
            // /dbconnections/change_password
            const passwordResetRes = await fetch(
                `https://auth.meteringco.example/api/v2/tickets/password-change
            `,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                        'cache-control': 'no-cache',
                    },
                    body: JSON.stringify({
                        email,
                        connection_id: 'con_MJwaDIMnFxFOHS3v',
                        result_url: 'https://api.prod.meteringco.example/users/login',
                    }),
                },
            );

            if (!passwordResetRes?.ok) {
                OrganizationEntity.logger.debug(await passwordResetRes.json(), 'passwordResetRes');
                await OrganizationEntity.handleErrors(
                    passwordResetRes,
                    'Error reseting user password during user creation for orgs',
                    'addUserToOrganization',
                );
            }
            if (!res?.ok) {
                await OrganizationEntity.handleErrors(res, 'Error creating user', 'addUserToOrganization');
            }
            // Get the user_id from the response

            const jsonResp = await res.json();
            const { user_id } = jsonResp;
            // Create add the user to the current businessID
            await usersService.create({ businessID, subject: user_id, environment: Environment.PRODUCTION });

            // Add the user to the organization
            const addUserToOrganization = await fetch(
                `https://auth.meteringco.example/api/v2/organizations/${organizationEntity?.orgId}/members`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                        'cache-control': 'no-cache',
                    },
                    body: JSON.stringify({ members: [user_id] }),
                },
            );
            if (!addUserToOrganization?.ok) {
                if (res.status === 404) {
                    throw new BadRequestException('Organization not found');
                } else {
                    const jsonResponse = await addUserToOrganization.json();
                    await OrganizationEntity.handleErrors(
                        jsonResponse,
                        'Error adding user to organization',
                        'addUserToOrganization',
                    );
                }
            }
            return { userId: user_id };
        } else {
            const { user_id } = data[0];
            // Create add the user to the current businessID
            await usersService.create({ businessID, subject: user_id, environment: Environment.PRODUCTION });
            const addUserToOrganization = await fetch(
                `https://auth.meteringco.example/api/v2/organizations/${organizationEntity?.orgId}/members`,
                {
                    method: 'POST',
                    headers: {
                        'content-type': 'application/json',
                        Authorization: `Bearer ${accessToken}`,
                        'cache-control': 'no-cache',
                    },
                    body: JSON.stringify({ members: [user_id] }),
                },
            );
            if (!addUserToOrganization?.ok) {
                if (addUserToOrganization.status === 404) {
                    throw new BadRequestException('Organization not found');
                } else {
                    let jsonResponse;
                    try {
                        jsonResponse = await addUserToOrganization.json();
                    } catch (e) {
                        OrganizationEntity.logger.debug(e, 'addUserToOrganization');
                    }
                    OrganizationEntity.logger.debug(jsonResponse, 'addUserToOrganization');
                    await OrganizationEntity.handleErrors(
                        addUserToOrganization,
                        'Error adding user to organization',
                        'addUserToOrganization',
                    );
                }
            }
            return { userId: user_id };
        }
    }
}
