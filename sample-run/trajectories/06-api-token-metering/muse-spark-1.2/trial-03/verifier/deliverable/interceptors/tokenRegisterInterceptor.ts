import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { TokenConsumer } from '../token-consumer/entities/token-consumer.entity';
import { TokenConsumerAsyncProcessor } from '../token-consumer/token-consumer-async-processor';
import { TokenType } from '../token-consumer/dto/TokenType';
import { randomUUID } from 'crypto';
import { Point } from '@influxdata/influxdb-client';
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
                            // Extract call details if provided (for testing / measurement path)
                            // The call arrives with an amount, a moment and identifying metadata
                            const body = req?.body || {};
                            const rawAmount = body.tokenAmount ?? body.amount ?? body.recordValue ?? req.headers?.['x-token-amount'] ?? req.headers?.['x-meteringco-amount'];
                            const amount = rawAmount !== undefined ? parseFloat(String(rawAmount)) : 0.001;
                            const rawTimestamp = body.timestamp ?? body.moment ?? body.time ?? req.headers?.['x-meteringco-timestamp'];
                            const timestamp = rawTimestamp ? new Date(rawTimestamp) : new Date();
                            const rawMetadata = body.metadata ?? body.identifyingMetadata ?? {};
                            // Ensure tokenType and uuid are present
                            const metadata: Record<string, string> = { ...(rawMetadata as any) };
                            if (!metadata.tokenType && !metadata['tokenType']) {
                                (metadata as any).tokenType = TokenType.apiCall;
                            }
                            // uuid for deduplication
                            const uuid = (metadata as any).uuid || (metadata as any).metadata_uuid || body.uuid || req.headers?.['x-meteringco-uuid'] || randomUUID();
                            (metadata as any).uuid = uuid;

                            const dogfoodCustomerDataRes = await TokenConsumerService.getMeteringCoCustomerId(
                                businessID,
                                subject,
                                this.environmentService,
                            );
                            if (dogfoodCustomerDataRes) {
                                TokenRegisterInterceptor.logger.debug(
                                    `TokenRegisterInterceptor: dogfoodCustomerDataRes: ${dogfoodCustomerDataRes?.meteringcoCustomerId} ${dogfoodCustomerDataRes?.saasCustomerAssociatedBusinessID}`,
                                );
                                const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = dogfoodCustomerDataRes;
                                // Determine dimensionId for platform customer
                                let dimensionId: string | undefined;
                                try {
                                    if (meteringcoCustomer?.offeringId) {
                                        const { dimensions } = await InfluxService.getMeteringCoOffering(meteringcoCustomer.offeringId);
                                        if (dimensions && dimensions.length) {
                                            const apiDim: any = dimensions.find((d: any) => d.dimensionName && String(d.dimensionName).toLowerCase().includes('api')) || dimensions[0];
                                            dimensionId = apiDim.dimensionId;
                                        }
                                    }
                                } catch {}
                                if (!dimensionId) {
                                    if (saasCustomerAssociatedBusinessID === 'meteringco-production') {
                                        dimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                                    } else if (saasCustomerAssociatedBusinessID === 'meteringco-sandbox') {
                                        dimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                                    } else {
                                        dimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                                    }
                                }
                                const point: Point = new Point(TokenConsumer._measurement)
                                    .tag('customerId', meteringcoCustomerId)
                                    .tag('businessID', saasCustomerAssociatedBusinessID)
                                    .tag('dimensionId', dimensionId)
                                    .tag('metadata_tokenType', JSON.stringify(TokenType.apiCall))
                                    .tag('metadata_uuid', JSON.stringify(uuid))
                                    .floatField('recordValue', amount)
                                    .timestamp(timestamp);
                                // Add any additional metadata tags (excluding tokenType/uuid which already added)
                                Object.keys(metadata).forEach((k) => {
                                    if (k !== 'uuid' && k !== 'tokenType' && k !== 'metadata_uuid' && k !== 'metadata_tokenType') {
                                        point.tag(`metadata_${k}`, JSON.stringify((metadata as any)[k]));
                                    }
                                });
                                // Must not add round trip: fire-and-forget with flush false
                                void this.influxService.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, this.influxService.org, [point], false);
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
}
