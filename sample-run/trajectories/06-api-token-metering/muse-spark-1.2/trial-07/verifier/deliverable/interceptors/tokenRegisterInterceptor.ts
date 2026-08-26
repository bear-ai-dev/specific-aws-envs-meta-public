import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
const FIVE_MINUTES_IN_MS = 300000;

@Injectable()
export class TokenRegisterInterceptor implements NestInterceptor {
    static logger = new Logger(TokenRegisterInterceptor.name);
    environmentService: EnvironmentService;
    constructor() {
        this.environmentService = new EnvironmentService(new InfluxService());
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
                            const dogfoodCustomerDataRes = await TokenConsumerService.getMeteringCoCustomerId(
                                businessID,
                                subject,
                                this.environmentService,
                            );
                            if (dogfoodCustomerDataRes) {
                                TokenRegisterInterceptor.logger.debug(
                                    `TokenRegisterInterceptor: dogfoodCustomerDataRes: ${dogfoodCustomerDataRes?.meteringcoCustomerId} ${dogfoodCustomerDataRes?.saasCustomerAssociatedBusinessID}`,
                                );
                                // Record one API call for serving this request.
                                // Use fire-and-forget write to aggregate bucket at the call's own moment,
                                // without adding a round trip (flush=false). Deduplication via uuid ensures
                                // at-least-once delivery does not double count, and unordered late arrivals
                                // are still recorded at their own moment (timestamp) but do not reopen a closed period.
                                const uuid = (req as any)?.headers?.['x-request-id'] || (req as any)?.headers?.['x-correlation-id'] || require('crypto').randomUUID();
                                const amount = '0.001';
                                const timestamp = new Date().toISOString();
                                const metadata: Record<string, string> = {
                                    tokenType: 'apiCall',
                                    uuid,
                                };
                                // Also propagate any identifying metadata from headers if present
                                void TokenConsumerService.registerApiCall(
                                    {
                                        businessID,
                                        subject,
                                        amount,
                                        timestamp,
                                        metadata,
                                    },
                                    this.environmentService,
                                    new InfluxService(),
                                );
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

    // Helper for direct registration (e.g., for measurement ingestion) that respects
    // amount, moment, and identifying metadata, with at-least-once deduplication via uuid
    // and unordered/late arrival handling (record at own moment, never re-date forward).
    // This method is also exposed for tests to simulate calls with specific timestamps.
    static async recordCall(
        params: { businessID: string; subject?: string; amount: string; timestamp: string; metadata: Record<string, string> },
        environmentService?: EnvironmentService,
        influxService?: InfluxService,
    ): Promise<void> {
        return TokenConsumerService.registerApiCall(params, environmentService, influxService);
    }
}
