import { Injectable, NotFoundException, Logger, InternalServerErrorException } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { cache as cacheManager } from '../cacheStore.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { Environment } from '../users/dto/Environment.js';
import { fetch } from 'cross-fetch';

@Injectable()
export class KeysService {
    private static readonly logger = new Logger(KeysService.name);
    constructor(readonly InfluxService: InfluxService) {}

    async findAll(businessID: string) {
        const { readAllUsersForBusiness } = this.InfluxService;
        const results = await readAllUsersForBusiness(businessID);
        // Filter machine credentials: subject ends with @clients
        const machineRows = results.filter((row: any) => row.subject && row.subject.endsWith('@clients'));
        if (machineRows.length === 0) {
            return { message: 'Found keys', data: [] };
        }
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        // Fetch details for each from IdP to get names, filter out missing
        const detailed = await Promise.all(
            machineRows.map(async (row: any) => {
                const clientId = row.subject.split('@')[0];
                try {
                    const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(clientId)}`, {
                        method: 'GET',
                        headers: {
                            Authorization: `Bearer ${access_token}`,
                            'content-type': 'application/json',
                        },
                    });
                    if (res.status === 404) {
                        return null;
                    }
                    if (!res.ok) {
                        KeysService.logger.warn(`Failed to fetch client ${clientId}: ${res.status}`);
                        return null;
                    }
                    const json: any = await res.json();
                    // Only return if it exists; include client_id and name
                    return json;
                } catch (e) {
                    KeysService.logger.warn(`Error fetching client ${clientId}: ${e}`);
                    return null;
                }
            }),
        );
        const filtered = detailed.filter(Boolean);
        // Sort by client_id for deterministic output
        filtered.sort((a: any, b: any) => a.client_id.localeCompare(b.client_id));
        return { message: 'Found keys', data: filtered };
    }

    private async verifyOwnership(businessID: string, keyId: string) {
        const { readAllUsersForBusiness } = this.InfluxService;
        const results = await readAllUsersForBusiness(businessID);
        const subject = `${keyId}@clients`;
        const found = results.find((row: any) => row.subject === subject);
        if (!found) {
            throw new NotFoundException(`Key ${keyId} not found`);
        }
        return found;
    }

    async rotate(businessID: string, keyId: string) {
        // Verify ownership before touching IdP, to leave IdP untouched if not owned
        const found: any = await this.verifyOwnership(businessID, keyId);
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(keyId)}/rotate-secret`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'content-type': 'application/json',
            },
        });
        if (res.status === 404) {
            throw new NotFoundException(`Key ${keyId} not found`);
        }
        if (!res.ok) {
            const body = await res.text();
            KeysService.logger.warn(`Rotate failed for ${keyId}: ${res.status} ${body}`);
            throw new InternalServerErrorException('Failed to rotate key');
        }
        const json: any = await res.json().catch(() => ({}));
        // Return new secret if available (useful for testing), but do not require it
        if (json.client_secret) {
            return { message: `Key ${keyId} rotated successfully`, client_secret: json.client_secret, client_id: json.client_id };
        }
        return { message: `Key ${keyId} rotated successfully` };
    }

    async remove(businessID: string, keyId: string) {
        const found: any = await this.verifyOwnership(businessID, keyId);
        // found contains subject, businessID, environment
        const subject = `${keyId}@clients`;
        const environment: Environment = found.environment;
        const { access_token } = await OrganizationEntity.getAuth0ManagementToken(cacheManager);
        const res = await fetch(`https://auth.meteringco.example/api/v2/clients/${encodeURIComponent(keyId)}`, {
            method: 'DELETE',
            headers: {
                Authorization: `Bearer ${access_token}`,
                'content-type': 'application/json',
            },
        });
        if (res.status === 404) {
            throw new NotFoundException(`Key ${keyId} not found`);
        }
        if (res.status !== 204 && !res.ok) {
            const body = await res.text();
            KeysService.logger.warn(`Delete failed for ${keyId}: ${res.status} ${body}`);
            throw new InternalServerErrorException('Failed to delete key');
        }
        // Soft delete in Influx: write new point with softDelete=deleted
        const { loadPoints } = this.InfluxService;
        const userEntity = new UserEntity({
            subject,
            businessID,
            environment,
            softDelete: 'deleted',
        });
        const points = UserEntity.transformer(userEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        // Clear cache for that credential so next request is refused immediately
        try {
            await cacheManager.del(subject);
            await cacheManager.del(`${subject}:${Environment.PRODUCTION}`);
            await cacheManager.del(`${subject}:${Environment.SANDBOX}`);
            await cacheManager.del(`${subject}:${environment}`);
        } catch (e) {
            KeysService.logger.warn(`Failed to clear cache for ${subject}: ${e}`);
        }
        return { message: `Key ${keyId} deleted successfully` };
    }
}
