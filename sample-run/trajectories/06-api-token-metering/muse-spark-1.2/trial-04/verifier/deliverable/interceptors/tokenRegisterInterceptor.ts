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
                tap(() => {
                    // Fire-and-forget to avoid adding round-trip to request
                    void (async () => {
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
                                    // Record the API call: serving a request counts as one
                                    const meteringcoCustomerId = dogfoodCustomerDataRes.meteringcoCustomerId;
                                    const platformBusinessID = dogfoodCustomerDataRes.meteringcoCustomer.businessID;
                                    const dimensionId = platformBusinessID === 'meteringco-production'
                                        ? '697f07d0-3180-4351-bdff-7ca029e6c18d'
                                        : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                                    const point = this.influxService.getPoint(TokenConsumer._measurement);
                                    point.tag('customerId', meteringcoCustomerId);
                                    point.tag('businessID', platformBusinessID);
                                    point.tag('dimensionId', dimensionId);
                                    point.tag('metadata_tokenType', JSON.stringify(TokenType.apiCall));
                                    // Use request metadata for deduplication: generate uuid from request if available, else random
                                    const uuid = (req as any)?.headers?.['x-request-id'] || randomUUID();
                                    point.tag('metadata_uuid', JSON.stringify(uuid));
                                    // Include additional identifying metadata if present
                                    if (req?.method) point.tag('metadata_method', JSON.stringify(req.method));
                                    if (req?.url) point.tag('metadata_path', JSON.stringify(req.url));
                                    point.floatField('recordValue', 1);
                                    // Use the moment of the call, not when it reached us: use request timestamp if available, else now
                                    const ts = (req as any)?.headers?.['x-request-timestamp'] ? new Date((req as any).headers['x-request-timestamp']) : new Date();
                                    point.timestamp(ts);
                                    // Fire-and-forget write to aggregate bucket without awaiting flush in request path
                                    // Must not add round trip: we void the promise
                                    void this.influxService.loadPoints(
                                        TokenConsumerAsyncProcessor.tokenAggregateBucket,
                                        process.env.INFLUX_ORG,
                                        [point],
                                        true,
                                    ).catch((e) => {
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
                    })();
                }),
            );
        } catch (e) {
            TokenRegisterInterceptor.logger.error('Failed to load tokens', e);
            return next.handle();
        }
    }
}
