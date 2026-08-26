import { Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService } from '../users/users.service.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { cache as cacheManager } from '../cacheStore.js';
import { fetch } from 'cross-fetch';

@Injectable()
export class ClientsService {
    private static readonly logger = new Logger(ClientsService.name);
    constructor(
        readonly influxService: InfluxService,
        readonly environmentService: EnvironmentService,
    ) {}

    async getManagementToken(): Promise<string> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        return access_token;
    }

    // List machine credentials for current businessID (environment already resolved)
    async listForBusiness(businessID: string, query: any = {}) {
        // Use influx to get all users for businessID filtered not deleted
        const { readAllUsersForBusiness } = this.influxService;
        const rows = await readAllUsersForBusiness(businessID);
        // rows are UserTable with subject like "key...@clients"
        // Filter to only those whose subject ends with @clients (machine credentials)
        const machineRows = rows.filter((r: any) => r.subject && r.subject.endsWith('@clients'));
        // For each, fetch Auth0 client details to get name etc
        const token = await this.getManagementToken();
        const results = [];
        for (const row of machineRows) {
            const clientId = row.subject.split('@')[0];
            try {
                const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
                    method: 'GET',
                    headers: {
                        'content-type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        'cache-control': 'no-cache',
                    },
                });
                if (!res.ok) {
                    // If Auth0 says not found, skip? But should still not include
                    ClientsService.logger.warn(`Auth0 client ${clientId} not found: ${res.status}`);
                    continue;
                }
                const data = await res.json();
                // data contains client_id, name, etc but not secret
                results.push({
                    client_id: data.client_id || clientId,
                    clientId: data.client_id || clientId,
                    name: data.name,
                    // include other fields if present
                    subject: row.subject,
                    businessID: row.businessID,
                    environment: row.environment,
                });
            } catch (e) {
                ClientsService.logger.error(`Failed to fetch client ${clientId}`, e);
            }
        }
        // Also alternative: if we want to ensure we capture all sorted, sort by client_id
        results.sort((a, b) => a.client_id.localeCompare(b.client_id));

        // Handle pagination like Auth0 does (per_page, page, include_totals)
        const includeTotals = String(query.include_totals || '').toLowerCase() === 'true';
        let perPage = parseInt(query.per_page || '50', 10);
        if (isNaN(perPage) || perPage < 1) perPage = 50;
        perPage = Math.min(perPage, 100);
        let page = parseInt(query.page || '0', 10);
        if (isNaN(page) || page < 0) page = 0;
        const start = page * perPage;
        const window = results.slice(start, start + perPage);
        if (includeTotals) {
            return { start, limit: perPage, total: results.length, clients: window, data: window };
        }
        // If pagination params were explicitly provided, return paginated window even without totals
        if (query.per_page !== undefined || query.page !== undefined) {
            return window;
        }
        return results;
    }

    // Validate that client belongs to businessID
    async validateOwnership(clientId: string, businessID: string) {
        const subject = `${clientId}@clients`;
        const { readAllUsersForBusiness } = this.influxService;
        const rows = await readAllUsersForBusiness(businessID);
        const found = rows.find((r: any) => r.subject === subject);
        if (!found) {
            throw new NotFoundException(`Client ${clientId} not found for business ${businessID}`);
        }
        // Also check Auth0 existence
        const token = await this.getManagementToken();
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok) {
            // If Auth0 says not found, treat as not found for tenant
            throw new NotFoundException(`Client ${clientId} not found`);
        }
        const data = await res.json();
        // Return found row and auth0 data
        return { row: found, auth0: data };
    }

    async rotate(clientId: string, businessID: string) {
        // validate ownership first - must not have side effect if fails
        await this.validateOwnership(clientId, businessID);
        const token = await this.getManagementToken();
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${token}`,
                'cache-control': 'no-cache',
            },
            body: JSON.stringify({}),
        });
        if (!res.ok) {
            const body = await res.text();
            ClientsService.logger.error(`Rotate failed ${clientId}: ${res.status} ${body}`);
            throw new NotFoundException(`Failed to rotate client ${clientId}`);
        }
        const data = await res.json();
        return data;
    }

    async retire(clientId: string, businessID: string) {
        // validate ownership
        const { row } = await this.validateOwnership(clientId, businessID);
        const token = await this.getManagementToken();
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${token}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok && res.status !== 204) {
            const body = await res.text();
            ClientsService.logger.error(`Delete failed ${clientId}: ${res.status} ${body}`);
            throw new NotFoundException(`Failed to delete client ${clientId}`);
        }
        // Soft delete in Influx: write point with softDelete=deleted
        const { loadPoints, getPoint } = this.influxService;
        const subject = `${clientId}@clients`;
        // Need environment from row
        const env = (row as any).environment;
        const point = getPoint(UserEntity._measurementActiveEnvironment);
        point.tag('subject', subject);
        point.tag('businessID', businessID);
        if (env) point.tag('environment', env);
        point.tag('softDelete', 'deleted');
        point.stringField('userStatus', 'live');
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, [point]);
        // Invalidate cache for this machine subject
        try {
            await cacheManager.del(subject);
        } catch (e) {}
        // Also invalidate any cache that lists business? Not needed as queries are not cached
        return { message: `Client ${clientId} deleted` };
    }
}
