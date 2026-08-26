import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { randomUUID } from 'crypto';
const FIVE_MINUTES_IN_MS = 300000;

@Injectable()
export class TokenRegisterInterceptor implements NestInterceptor {
    static logger = new Logger(TokenRegisterInterceptor.name);
    environmentService: EnvironmentService;
    influxService: InfluxService;
    // Keep a lightweight token service instance for fire-and-forget registration
    private tokenConsumerService: TokenConsumerService;
    constructor() {
        this.influxService = new InfluxService();
        this.environmentService = new EnvironmentService(this.influxService);
        // Scheduler and auth are not needed for registerApiCall fire-and-forget; pass nulls with casting
        this.tokenConsumerService = new TokenConsumerService(null as any, null as any, this.environmentService, this.influxService);
    }
    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        try {
            return next.handle().pipe(
                tap(() => {
                    // fire-and-forget registration so request is not blocked by influx round-trip
                    void (async () => {
                        try {
                            const req = context.switchToHttp().getRequest();
                            const res = context.switchToHttp().getResponse();
                            TokenConsumerService.logger.debug(`TokenRegisterInterceptor: res: ${res?.statusCode}`);

                            if (res?.statusCode < 400) {
                                const businessID = req?.user?.businessID;
                                const subject = req?.user?.sub;
                                if (!businessID) return;
                                // Each served request counts as one apiCall
                                const timestamp = new Date().toISOString();
                                const metadata: Record<string, any> = {
                                    uuid: randomUUID(),
                                    tokenType: 'apiCall',
                                };
                                // Include request identifiers for traceability if available
                                if (req?.user?.businessID) metadata.requestBusinessID = req.user.businessID;
                                if (req?.route?.path) metadata.path = req.route.path;
                                await this.tokenConsumerService.registerApiCall({
                                    businessID,
                                    subject,
                                    timestamp,
                                    amount: 1,
                                    metadata,
                                });
                                TokenRegisterInterceptor.logger.debug(`TokenRegisterInterceptor: registered apiCall for ${businessID}`);
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
