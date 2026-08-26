import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { TokenType } from '../token-consumer/dto/TokenType';
import { randomUUID } from 'crypto';
const FIVE_MINUTES_IN_MS = 300000;

@Injectable()
export class TokenRegisterInterceptor implements NestInterceptor {
    static logger = new Logger(TokenRegisterInterceptor.name);
    environmentService: EnvironmentService;
    tokenConsumerService: TokenConsumerService;
    constructor() {
        const influx = new InfluxService();
        this.environmentService = new EnvironmentService(influx as any);
        // Construct a TokenConsumerService instance for recording without full Nest DI.
        // It will use its own InfluxService internally and the same EnvironmentService.
        this.tokenConsumerService = new TokenConsumerService(null as any, null as any, this.environmentService as any, influx as any);
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
                                // Record the API call - serving a request counts as one
                                // Must not add round trip: fire and forget, do not await flush
                                const amount = 1;
                                const timestamp = new Date().toISOString();
                                // Use request id or generate uuid for idempotency
                                const uuid = req?.headers?.['x-request-id'] || req?.headers?.['x-correlation-id'] || randomUUID();
                                // Call recordApiCall but do not await its internal flush in a way that blocks response
                                // We invoke without awaiting outer tapi? actually tap will await this async, but inner recordApiCall is fire-and-forget
                                this.tokenConsumerService.recordApiCall({
                                    businessID,
                                    subject,
                                    amount: amount.toString(),
                                    timestamp,
                                    metadata: {
                                        tokenType: TokenType.apiCall,
                                        uuid,
                                    },
                                }).catch((e) => {
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
}
