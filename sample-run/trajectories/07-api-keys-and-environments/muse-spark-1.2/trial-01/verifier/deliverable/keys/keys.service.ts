import { Injectable, NotFoundException, Logger, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { cache as cacheManager } from '../cacheStore.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { Environment } from '../users/dto/Environment.js';
import fetch from 'cross-fetch';

@Injectable()
export class KeysService {
    private readonly logger = new Logger(KeysService.name);
    constructor(private readonly influxService: InfluxService) {}

    private async getManagementToken(): Promise<string> {
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        return access_token;
    }

    // List keys for a given businessID - only those live and whose subject ends with @clients
    async listKeys(businessID: string): Promise<any[]> {
        // Query influx for all users for this businessID, filter live machine credentials
        const rows = await this.influxService.readAllUsersForBusiness(businessID);
        // rows are UserTable objects with subject, businessID, environment, softDelete filtered already
        // But need to filter to only machine clients (subject ends with @clients)
        const machineRows = rows.filter((r: any) => typeof r.subject === 'string' && r.subject.endsWith('@clients'));
        if (machineRows.length === 0) {
            return [];
        }
        const token = await this.getManagementToken();
        const results: any[] = [];
        for (const row of machineRows) {
            const subject = row.subject as string;
            const clientId = subject.replace(/@clients$/, '');
            try {
                const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
                    method: 'GET',
                    headers: {
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'cache-control': 'no-cache',
                    },
                });
                if (!res.ok) {
                    this.logger.warn(`Failed to fetch client ${clientId}: ${res.status}`);
                    continue;
                }
                const clientJson = await res.json();
                // ensure it is a machine credential (non_interactive) maybe filter out spa?
                // Include only if it exists; the influx row ensures ownership
                results.push(clientJson);
            } catch (e) {
                this.logger.error(`Error fetching client ${clientId}`, e);
            }
        }
        // Sort by client_id for determinism
        results.sort((a, b) => a.client_id.localeCompare(b.client_id));
        return results;
    }

    async verifyOwnership(businessID: string, clientId: string): Promise<{ subject: string; environment: Environment; row: any } | null> {
        const cleanId = clientId.replace(/@clients$/, '');
        const subject = `${cleanId}@clients`;
        const rows = await this.influxService.readAllUsersForBusiness(businessID);
        const match = rows.find((r: any) => r.subject === subject);
        if (!match) {
            return null;
        }
        // Also need to ensure not soft-deleted but readAllUsersForBusiness already filters deleted.
        // However there is a separate path for already soft-deleted row that is filtered out, so null = not owned
        // Return environment stored in row
        return { subject, environment: (match as any).environment, row: match };
    }

    async rotateKey(businessID: string, clientId: string): Promise<any> {
        const cleanId = clientId.replace(/@clients$/, '');
        const ownership = await this.verifyOwnership(businessID, cleanId);
        if (!ownership) {
            throw new NotFoundException(`Client ${clientId} not found for current account`);
        }
        const token = await this.getManagementToken();
        // Verify client exists at IdP before rotating? fetch first to ensure exists, but rotate will 404 if not.
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(cleanId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok) {
            const body = await res.text();
            this.logger.error(`Rotate failed for ${clientId}: ${res.status} ${body}`);
            if (res.status === 404) {
                throw new NotFoundException(`Client ${clientId} not found`);
            }
            throw new InternalServerErrorException(`Failed to rotate key`);
        }
        const json = await res.json();
        return json;
    }

    async retireKey(businessID: string, clientId: string): Promise<void> {
        const cleanId = clientId.replace(/@clients$/, '');
        const ownership = await this.verifyOwnership(businessID, cleanId);
        if (!ownership) {
            throw new NotFoundException(`Client ${clientId} not found for current account`);
        }
        const token = await this.getManagementToken();
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(cleanId)}`, {
            method: 'DELETE',
            headers: {
                'content-type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'cache-control': 'no-cache',
            },
        });
        if (!res.ok && res.status !== 204) {
            const body = await res.text();
            this.logger.error(`Delete failed for ${clientId}: ${res.status} ${body}`);
            if (res.status === 404) {
                throw new NotFoundException(`Client ${clientId} not found`);
            }
            throw new InternalServerErrorException(`Failed to retire key`);
        }
        // Soft delete in influx: write a point with softDelete=deleted for that subject/businessID/environment
        const subject = ownership.subject;
        const environment = ownership.environment;
        // Need to write point with same tags but softDelete
        const userEntity = new UserEntity({
            subject,
            businessID,
            environment,
            softDelete: 'deleted',
        });
        const points = UserEntity.transformer(userEntity, this.influxService);
        await this.influxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        // Clear cache for that subject so next request is rejected immediately
        try {
            await cacheManager.del(subject);
        } catch (e) {
            this.logger.warn(`Failed to del cache for ${subject}`, e);
        }
        // Also clear cache for businessID? Not needed
    }
}
