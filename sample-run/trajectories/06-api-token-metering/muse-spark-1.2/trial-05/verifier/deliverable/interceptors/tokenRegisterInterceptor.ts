import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { EnvironmentService } from '../users/users.service.js';
import { InfluxService } from '../influx/influx.service.js';
import { TokenConsumer } from '../token-consumer/entities/token-consumer.entity.js';
import { TokenConsumerAsyncProcessor } from '../token-consumer/token-consumer-async-processor.js';
import { TokenType } from '../token-consumer/dto/TokenType.js';
import { randomUUID } from 'crypto';
const FIVE_MINUTES_IN_MS = 300000;

@Injectable()
export class TokenRegisterInterceptor implements NestInterceptor {
    static logger = new Logger(TokenRegisterInterceptor.name);
    environmentService: EnvironmentService;
    influxService: InfluxService;
    constructor() {
        this.influxService = new InfluxService();
        this.environmentService = new EnvironmentService(this.influxService);
    }
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        try {
            return next.handle().pipe(
                tap(async () => {
                    try {
                        const req = context.switchToHttp().getRequest();
                        const res = context.switchToHttp().getResponse();
                        TokenConsumerService.logger.debug(`TokenRegisterInterceptor: res: ${res?.statusCode}`);

                        if (res?.statusCode < 400) {
                            const businessID = req?.user?.businessID;
                            const subject = req?.user?.sub;
                            if (!businessID) return;
                            const dogfoodCustomerDataRes = await TokenConsumerService.getMeteringCoCustomerId(
                                businessID,
                                subject,
                                this.environmentService,
                            );
                            if (dogfoodCustomerDataRes) {
                                TokenRegisterInterceptor.logger.debug(
                                    `TokenRegisterInterceptor: dogfoodCustomerDataRes: ${dogfoodCustomerDataRes?.meteringcoCustomerId} ${dogfoodCustomerDataRes?.saasCustomerAssociatedBusinessID}`,
                                );
                                // Record API call against platform's own customer in aggregate bucket
                                // Call arrives with amount, moment, identifying metadata
                                // Use request-derived values; default amount 0.001, moment now, uuid from header or generated
                                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = dogfoodCustomerDataRes;
                                const dimensionId = saasCustomerAssociatedBusinessID === 'meteringco-production'
                                    ? '697f07d0-3180-4351-bdff-7ca029e6c18d'
                                    : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                                // Amount - try to read from request if provided as MeteringCoToken, else default 0.001
                                let amount = '0.001';
                                let moment = new Date().toISOString();
                                let metadata: any = { tokenType: TokenType.apiCall };
                                // If request body contains token-like data, use it
                                if (req?.body?.tokenAmount) amount = String(req.body.tokenAmount);
                                else if (req?.headers?.['x-meteringco-amount']) amount = String(req.headers['x-meteringco-amount']);
                                else if (req?.headers?.['x-amount']) amount = String(req.headers['x-amount']);
                                if (req?.body?.timestamp) moment = String(req.body.timestamp);
                                else if (req?.headers?.['x-meteringco-timestamp']) moment = String(req.headers['x-meteringco-timestamp']);
                                else if (req?.body?.moment) moment = String(req.body.moment);
                                // Identifying metadata - uuid
                                let uuid: string | undefined;
                                if (req?.body?.metadata?.uuid) uuid = String(req.body.metadata.uuid);
                                else if (req?.body?.metadata?.metadata_uuid) uuid = String(req.body.metadata.metadata_uuid);
                                else if (req?.headers?.['x-meteringco-uuid']) uuid = String(req.headers['x-meteringco-uuid']);
                                else if (req?.headers?.['x-request-id']) uuid = String(req.headers['x-request-id']);
                                else if (req?.headers?.['x-uuid']) uuid = String(req.headers['x-uuid']);
                                else uuid = randomUUID();
                                metadata.uuid = uuid;
                                // Preserve any other metadata from body
                                if (req?.body?.metadata && typeof req.body.metadata === 'object') {
                                    for (const [k, v] of Object.entries(req.body.metadata)) {
                                        if (k !== 'tokenType' && k !== 'uuid') metadata[k] = v;
                                    }
                                }
                                const point = this.influxService.getPoint(TokenConsumer._measurement);
                                point.tag('customerId', meteringcoCustomerId);
                                point.tag('businessID', saasCustomerAssociatedBusinessID);
                                point.tag('dimensionId', dimensionId);
                                point.tag('metadata_tokenType', JSON.stringify(TokenType.apiCall));
                                point.tag('metadata_uuid', JSON.stringify(uuid));
                                // Add remaining metadata as tags
                                for (const [k, v] of Object.entries(metadata)) {
                                    if (k === 'tokenType' || k === 'uuid') continue;
                                    point.tag(`metadata_${k}`, JSON.stringify(v));
                                }
                                point.floatField('recordValue', parseFloat(amount));
                                point.timestamp(new Date(moment));
                                // Must not add round trip to request -> fire-and-forget with flush false
                                void this.influxService.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, this.influxService.org, [point], false).catch((e) => {
                                    TokenRegisterInterceptor.logger.error('Failed to record api call', e);
                                });
                            }
                        }
                    } catch (e) {
                        TokenRegisterInterceptor.logger.error('Failed to load tokens', e);

                        AuditService.publishEvent({
                            data: [e],
                            topic: AuditScope.ERROR,
                            message: 'Failed to load tokens',
                        });
                    }
                }),
            );
        } catch (e) {
            TokenRegisterInterceptor.logger.error('Failed to load tokens', e);
            return next.handle();
        }
    }
    // Helper for direct registration (e.g., accepting a measurement) - also fire-and-forget
    async registerCall(businessID: string, subject: string, amount: string, moment: string, metadata: any): Promise<void> {
        try {
            const dogfoodCustomerDataRes = await TokenConsumerService.getMeteringCoCustomerId(businessID, subject, this.environmentService);
            if (!dogfoodCustomerDataRes) return;
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID } = dogfoodCustomerDataRes;
            const dimensionId = saasCustomerAssociatedBusinessID === 'meteringco-production'
                ? '697f07d0-3180-4351-bdff-7ca029e6c18d'
                : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
            const point = this.influxService.getPoint(TokenConsumer._measurement);
            point.tag('customerId', meteringcoCustomerId);
            point.tag('businessID', saasCustomerAssociatedBusinessID);
            point.tag('dimensionId', dimensionId);
            point.tag('metadata_tokenType', JSON.stringify(TokenType.apiCall));
            const uuid = metadata?.uuid || metadata?.metadata_uuid || randomUUID();
            point.tag('metadata_uuid', JSON.stringify(uuid));
            for (const [k, v] of Object.entries(metadata || {})) {
                if (k === 'tokenType' || k === 'uuid' || k === 'metadata_uuid') continue;
                point.tag(`metadata_${k}`, JSON.stringify(v));
            }
            point.floatField('recordValue', parseFloat(amount));
            point.timestamp(new Date(moment));
            void this.influxService.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, this.influxService.org, [point], false).catch((e) => {
                TokenRegisterInterceptor.logger.error('Failed to record api call via helper', e);
            });
        } catch (e) {
            TokenRegisterInterceptor.logger.error('Failed to record api call via helper', e);
        }
    }
}
