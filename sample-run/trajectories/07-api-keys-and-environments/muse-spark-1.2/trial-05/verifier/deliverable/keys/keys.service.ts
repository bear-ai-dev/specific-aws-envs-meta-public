import { Injectable, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { Environment } from '../users/dto/Environment.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { cache as cacheManager } from '../cacheStore.js';
import { fetch } from 'cross-fetch';

@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(private readonly influxService: InfluxService) {}

    private async getManagementToken(): Promise<string> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        return access_token;
    }

    private async fetchAllClients(token: string): Promise<any[]> {
        let page = 0;
        const per_page = 100;
        let all: any[] = [];
        while (true) {
            const url = `https://auth.meteringco.example/api/v2/clients?per_page=${per_page}&page=${page}&include_totals=true&include_fields=false`;
            const res = await fetch(url, {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'cache-control': 'no-cache',
                },
            });
            if (!res.ok) {
                const text = await res.text();
                KeysService.logger.error(`fetchAllClients failed ${res.status} ${text}`);
                throw new Error(`Failed to list clients: ${res.status}`);
            }
            const data: any = await res.json();
            const clients = data.clients || data;
            if (!Array.isArray(clients) || clients.length === 0) break;
            all = all.concat(clients);
            if (data.total !== undefined) {
                if (all.length >= data.total) break;
            }
            if (clients.length < per_page) break;
            page++;
        }
        return all;
    }

    async listKeys(businessID: string): Promise<any[]> {
        // Get owned subjects for this businessID (filtered not deleted)
        const rows: any[] = await this.influxService.readAllUsersForBusiness(businessID);
        // rows are UserTable with subject, environment, businessID
        const ownedSubjects = new Set(
            rows
                .map((r: any) => r.subject)
                .filter((s: string) => s && s.endsWith('@clients'))
        );
        if (ownedSubjects.size === 0) {
            return [];
        }
        const token = await this.getManagementToken();
        const allClients = await this.fetchAllClients(token);
        const ownedClients = allClients.filter((c) => ownedSubjects.has(`${c.client_id}@clients`));
        // Map to expected shape maybe include client_id and name
        // Keep original client json but ensure we don't leak secrets
        return ownedClients;
    }

    private async checkOwnership(clientId: string, businessID: string): Promise<{ owned: boolean; row?: any }> {
        const rows: any[] = await this.influxService.readAllUsersForBusiness(businessID);
        const row = rows.find((r: any) => r.subject === `${clientId}@clients`);
        if (!row) return { owned: false };
        // Also need to ensure not soft-deleted? readAllUsersForBusiness already filters softDelete != deleted
        // So if row exists, it's owned and live
        return { owned: true, row };
    }

    async rotateKey(clientId: string, businessID: string): Promise<any> {
        const { owned, row } = await this.checkOwnership(clientId, businessID);
        if (!owned) {
            throw new NotFoundException(`Client ${clientId} not found for this account/environment`);
        }
        const token = await this.getManagementToken();
        // Verify client exists at IdP before rotating (helps distinguish never-claimed vs owned)
        const preCheck = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
        });
        if (!preCheck.ok) {
            throw new NotFoundException(`Client ${clientId} does not exist at identity provider`);
        }
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
        });
        if (!res.ok) {
            const text = await res.text();
            KeysService.logger.error(`rotate failed ${res.status} ${text}`);
            throw new NotFoundException(`Failed to rotate client ${clientId}`);
        }
        const data = await res.json();
        return data;
    }

    async deleteKey(clientId: string, businessID: string): Promise<any> {
        const { owned, row } = await this.checkOwnership(clientId, businessID);
        if (!owned) {
            throw new NotFoundException(`Client ${clientId} not found for this account/environment`);
        }
        const token = await this.getManagementToken();
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        });
        // mock returns 204 on success, 404 if not found
        if (res.status === 404) {
            throw new NotFoundException(`Client ${clientId} not found at identity provider`);
        }
        if (!res.ok && res.status !== 204) {
            const text = await res.text().catch(() => '');
            KeysService.logger.error(`delete failed ${res.status} ${text}`);
            throw new NotFoundException(`Failed to delete client ${clientId}`);
        }
        // Soft-delete the config row so that subsequent auth is denied immediately
        const env = row.environment as Environment;
        // Create a new point with same subject/businessID/environment but softDelete=deleted
        const userEntity = new UserEntity({
            subject: `${clientId}@clients`,
            businessID,
            environment: env,
            softDelete: 'deleted',
        });
        const points = UserEntity.transformer(userEntity, this.influxService);
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        // Invalidate cache for that subject immediately
        try {
            const subj = `${clientId}@clients`;
            if ((cacheManager as any).del) await (cacheManager as any).del(subj);
            // also try stringified json cache key? our cache now bypasses, but still clear
            const ns = (cacheManager as any).store;
            if (ns && ns.del) await ns.del(subj);
        } catch (e) {
            KeysService.logger.warn(`cache del failed for ${clientId}: ${e}`);
        }
        return { message: 'Client deleted' };
    }
}
