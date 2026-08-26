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
                            // The moment the call happened, this is what the call is metered at.
                            const timestamp = new Date().toISOString();
                            const dogfoodCustomerDataRes = await TokenConsumerService.getMeteringCoCustomerId(
                                businessID,
                                subject,
                                this.environmentService,
                            );
                            if (dogfoodCustomerDataRes) {
                                TokenRegisterInterceptor.logger.debug(
                                    `TokenRegisterInterceptor: dogfoodCustomerDataRes: ${dogfoodCustomerDataRes?.meteringcoCustomerId} ${dogfoodCustomerDataRes?.saasCustomerAssociatedBusinessID}`,
                                );
                                const uuid = TokenRegisterInterceptor.getRequestIdentifier(req);
                                await TokenConsumerService.registerToken(
                                    {
                                        businessID,
                                        subject,
                                        tokenAmount: TokenConsumerService.apiCallTokenAmount,
                                        timestamp,
                                        metadata: {
                                            tokenType: TokenType.apiCall,
                                            ...(uuid ? { uuid } : {}),
                                        },
                                    },
                                    this.influxService,
                                    this.environmentService,
                                    dogfoodCustomerDataRes,
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

    /**
     * Identifying metadata for the call, when the caller hands us an identifier we keep it, which
     * makes a retried (at-least-once delivered) call register the exact same token instead of a second one.
     */
    static getRequestIdentifier(req): string | undefined {
        const identifier =
            req?.headers?.['x-meteringco-idempotency-key'] ||
            req?.headers?.['idempotency-key'] ||
            req?.headers?.['x-request-id'] ||
            req?.id;
        return identifier ? `${identifier}` : undefined;
    }
}
