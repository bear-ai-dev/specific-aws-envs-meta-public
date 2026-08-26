import { Injectable, NotFoundException, Logger, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService } from '../users/users.service.js';
import { cache as cacheManager } from '../cacheStore.js';
import { Environment } from '../users/dto/Environment.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { fetch } from 'cross-fetch';

@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(
        readonly influxService: InfluxService,
        readonly environmentService: EnvironmentService,
    ) {}

    private async getMgmtToken(): Promise<string> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        return access_token;
    }

    private async fetchIdentity(path: string, init?: RequestInit): Promise<Response> {
        const token = await this.getMgmtToken();
        const headers = {
            'content-type': 'application/json',
            Authorization: `Bearer ${token}`,
            'cache-control': 'no-cache',
            ...(init?.headers as any),
        };
        const res = await fetch(`https://auth.meteringco.example${path}`, {
            ...init,
            headers,
        });
        return res as any;
    }

    async listKeysForBusiness(businessID: string, subject: string, environment?: Environment): Promise<any> {
        // Get owned subjects for this businessID - businessID already isolates environment (production vs sandbox suffix)
        // No need to filter by environment separately; retained for safety but not required
        const results = await this.influxService.readAllUsersForBusiness(businessID);
        const ownedSubjects = results
            .map((r: any) => r.subject)
            .filter((s: string) => s && s.endsWith('@clients'));

        // If no owned, return empty
        if (ownedSubjects.length === 0) {
            return [];
        }
        const ownedClientIds = new Set(ownedSubjects.map(s => s.split('@')[0]));

        // Fetch all clients from identity provider
        const res = await this.fetchIdentity(`/api/v2/clients?per_page=100&include_fields=false&fields=client_secret&page=0`);
        if (!res.ok) {
            KeysService.logger.error(`Failed to list clients from identity: ${res.status}`);
            throw new NotFoundException('Failed to list keys');
        }
        const body: any = await (res as any).json();
        const clients = Array.isArray(body) ? body : body.clients || [];
        const filtered = clients.filter((c: any) => ownedClientIds.has(c.client_id));
        // Sort for determinism
        filtered.sort((a: any, b: any) => a.client_id.localeCompare(b.client_id));
        return filtered;
    }

    async validateOwnership(clientId: string, businessID: string, subject: string): Promise<{ environment: Environment; ownedSubject: string }> {
        const curEnvRes = await this.environmentService.getCurrentEnvironment(subject);
        const env = curEnvRes.environment;
        const ownedSubject = `${clientId}@clients`;
        // Check Influx ownership
        const results = await this.influxService.readUserData(ownedSubject, env);
        if (!results || results.length === 0) {
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        const row: any = results[0];
        const rowBusinessID = row.businessID;
        if (rowBusinessID !== businessID) {
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        // Check not softDelete deleted (readUserData already filters, but double check)
        if (row.softDelete === 'deleted') {
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        // Check identity provider still has client
        const res = await this.fetchIdentity(`/api/v2/clients/${encodeURIComponent(clientId)}`);
        if (res.status === 404) {
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        if (!res.ok) {
            const j = await (res as any).json().catch(() => ({}));
            KeysService.logger.error(`Identity check failed for ${clientId}: ${JSON.stringify(j)}`);
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        return { environment: env, ownedSubject };
    }

    async rotateKey(clientId: string, businessID: string, subject: string): Promise<any> {
        const { environment } = await this.validateOwnership(clientId, businessID, subject);
        const res = await this.fetchIdentity(`/api/v2/clients/${encodeURIComponent(clientId)}/rotate-secret`, {
            method: 'POST',
            body: JSON.stringify({}),
        });
        if (!res.ok) {
            const j = await (res as any).json().catch(() => ({}));
            KeysService.logger.error(`Rotate failed: ${JSON.stringify(j)}`);
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        const body: any = await (res as any).json();
        return body;
    }

    async deleteKey(clientId: string, businessID: string, subject: string): Promise<void> {
        const { environment, ownedSubject } = await this.validateOwnership(clientId, businessID, subject);
        // Delete from identity provider first
        const res = await this.fetchIdentity(`/api/v2/clients/${encodeURIComponent(clientId)}`, {
            method: 'DELETE',
        });
        if (res.status === 404) {
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        if (res.status !== 204 && !res.ok) {
            const j = await (res as any).text().catch(() => '');
            KeysService.logger.error(`Delete failed: ${j}`);
            throw new NotFoundException(`Key ${clientId} not found`);
        }
        // Soft delete in Influx
        const { UsersService } = await import('../users/users.service.js');
        // Use direct influx write to avoid circular dep
        // We have influxService, we can write softDelete point directly
        // Import UserEntity dynamically to avoid circular?
        const { UserEntity } = await import('../users/entities/user.entity.js');
        const entity = new UserEntity({ subject: ownedSubject, businessID, environment, softDelete: 'deleted' });
        const points = UserEntity.transformer(entity, this.influxService as any);
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG as string, points);
        try {
            await (cacheManager as any).del(ownedSubject);
        } catch (e) {}
        // Also delete cache for businessID? Not needed
    }
}
