import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { TokenType } from '../token-consumer/dto/TokenType';
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
                            const dogfoodCustomerDataRes = await TokenConsumerService.getMeteringCoCustomerId(
                                businessID,
                                subject,
                                this.environmentService,
                            );
                            if (dogfoodCustomerDataRes) {
                                TokenRegisterInterceptor.logger.debug(
                                    `TokenRegisterInterceptor: dogfoodCustomerDataRes: ${dogfoodCustomerDataRes?.meteringcoCustomerId} ${dogfoodCustomerDataRes?.saasCustomerAssociatedBusinessID}`,
                                );
                                // Serving a request for a tenant is one api call of the platform's
                                // own product. The record is timestamped with the moment the call
                                // was served, and buffered, so the request pays nothing for it.
                                await TokenConsumerService.registerToken({
                                    meteringcoToken: {
                                        businessID,
                                        subject,
                                        tokenAmount: TokenConsumerService.apiCallTokenAmount,
                                        timestamp: new Date().toISOString(),
                                        metadata: {
                                            tokenType: TokenType.apiCall,
                                            ...TokenRegisterInterceptor.identifyingMetadata(req),
                                        },
                                    },
                                    influxService: this.influxService,
                                    environmentService: this.environmentService,
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

    /**
     * Any identity the caller handed over with the call travels with the record. Two
     * handovers of the same call carry the same identity, so the record of the call does
     * not double up.
     */
    static identifyingMetadata(req): Record<string, string> {
        const uuid =
            req?.headers?.['x-meteringco-request-id'] ||
            req?.headers?.['x-request-id'] ||
            req?.headers?.['x-idempotency-key'];
        return uuid ? { uuid: uuid.toString() } : {};
    }
}
