import { Injectable, Logger, NotFoundException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService, UsersService } from '../users/users.service.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { cache as cacheManager } from '../cacheStore.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { Environment } from '../users/dto/Environment.js';

@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        readonly influxService: InfluxService,
        readonly environmentService: EnvironmentService,
        readonly usersService: UsersService,
    ) {}

    private async getManagementToken(): Promise<string> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        return access_token;
    }

    private async listClientsForBusiness(businessID: string): Promise<any[]> {
        // Get all subjects for businessID via influx
        const { readAllUsersForBusiness } = this.influxService;
        const rows = await readAllUsersForBusiness(businessID);
        // rows are UserTable with subject, businessID, environment etc, filtered for softDelete != deleted and latest unique
        // Build set of client_ids for machine credentials (subject ending with @clients)
        const subjectSet = new Set<string>();
        const clientIdSet = new Set<string>();
        for (const row of rows) {
            const subj = (row as any).subject as string;
            if (!subj) continue;
            subjectSet.add(subj);
            // subject is like keyHarborlineProdIngest@clients
            const clientId = subj.split('@')[0];
            clientIdSet.add(clientId);
        }

        if (clientIdSet.size === 0) return [];

        const token = await this.getManagementToken();
        // Fetch via Auth0 list with pagination
        const allClients: any[] = [];
        let page = 0;
        const perPage = 50;
        while (true) {
            const res = await fetch(`https://auth.meteringco.example/api/v2/clients?per_page=${perPage}&page=${page}&include_totals=false&include_fields=false&fields=client_id,name,app_type,tenant`, {
                method: 'GET',
                headers: {
                    'content-type': 'application/json',
                    Authorization: `Bearer ${token}`,
                    'cache-control': 'no-cache',
                },
            });
            if (!res.ok) {
                KeysService.logger.error(`Failed to list clients page ${page}: ${res.status}`);
                const txt = await res.text();
                KeysService.logger.error(txt);
                throw new InternalServerErrorException('Failed to list keys');
            }
            const body = await res.json();
            const clients = Array.isArray(body) ? body : (body.clients || []);
            if (clients.length === 0) break;
            // Filter to those belonging to businessID
            for (const c of clients) {
                if (clientIdSet.has(c.client_id)) {
                    // Double-check subject still matches (subject = client_id@clients)
                    const subj = `${c.client_id}@clients`;
                    if (subjectSet.has(subj)) {
                        allClients.push(c);
                    }
                }
            }
            if (clients.length < perPage) break;
            page++;
            if (page > 10) break; // safety
        }
        // Sort for determinism
        allClients.sort((a, b) => a.client_id.localeCompare(b.client_id));
        return allClients;
    }

    async findAll(businessID: string): Promise<any> {
        const clients = await this.listClientsForBusiness(businessID);
        return clients;
    }

    private async validateOwnership(clientId: string, businessID: string): Promise<{ subject: string; businessID: string; environment?: string }> {
        const { readAllUsersForBusiness } = this.influxService;
        const rows = await readAllUsersForBusiness(businessID);
        const targetSubject = `${clientId}@clients`;
        for (const row of rows) {
            const subj = (row as any).subject as string;
            if (subj === targetSubject) {
                // Also verify that this row's businessID matches requested businessID and is not deleted (already filtered)
                // And ensure client exists in Auth0
                const token = await this.getManagementToken();
                const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
                    method: 'GET',
                    headers: {
                        'content-type': 'application/json',
                        Authorization: `Bearer ${token}`,
                        'cache-control': 'no-cache',
                    },
                });
                if (!res.ok) {
                    // If not found in Auth0, treat as not owned
                    KeysService.logger.warn(`Client ${clientId} not found in Auth0 during validation`);
                    throw new NotFoundException(`Key ${clientId} not found`);
                }
                const client = await res.json();
                // ensure app_type is non_interactive? but okay
                return { subject: targetSubject, businessID, environment: (row as any).environment };
            }
        }
        throw new NotFoundException(`Key ${clientId} not found`);
    }

    async rotateSecret(clientId: string, businessID: string): Promise<any> {
        // Validate ownership first; must not mutate if not owned
        const ownership = await this.validateOwnership(clientId, businessID);
        // Now perform rotation
        const token = await this.getManagementToken();
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${token}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok) {
            const txt = await res.text();
            KeysService.logger.error(`Rotate secret failed for ${clientId}: ${res.status} ${txt}`);
            throw new InternalServerErrorException('Failed to rotate secret');
        }
        const body = await res.json();
        // Invalidate cache for the credential subject just in case (though rotation doesn't affect influx)
        try {
            await (cacheManager as any).del(ownership.subject);
            await (cacheManager as any).del(clientId);
        } catch {}
        return body;
    }

    async deleteKey(clientId: string, businessID: string, environment?: Environment): Promise<any> {
        const ownership = await this.validateOwnership(clientId, businessID);
        const token = await this.getManagementToken();
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: {
                'content-type': 'application/json',
                Authorization: `Bearer ${token}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok && res.status !== 204) {
            const txt = await res.text();
            KeysService.logger.error(`Delete client failed for ${clientId}: ${res.status} ${txt}`);
            throw new InternalServerErrorException('Failed to delete key');
        }
        // Soft delete in influx
        const envToUse = (ownership.environment as Environment) || environment;
        await this.usersService.softDeleteUserConfig(ownership.subject, businessID, envToUse as Environment);
        // Also ensure cache deletion for that subject
        try {
            await (cacheManager as any).del(ownership.subject);
        } catch {}
        return { message: 'Key deleted successfully' };
    }
}
