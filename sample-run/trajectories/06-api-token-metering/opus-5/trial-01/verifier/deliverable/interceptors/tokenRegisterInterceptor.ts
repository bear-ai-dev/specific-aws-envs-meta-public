import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { MeteringCoToken } from '../token-consumer/dto/meteringcoToken.dto';
import { TokenType } from '../token-consumer/dto/TokenType';
import { randomUUID } from 'crypto';

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
                                // Serving a request for a SaaS business is one MeteringCo API call.
                                // The call is registered out of band, no round trip is added to the request itself.
                                const meteringcoToken = new MeteringCoToken({
                                    businessID,
                                    subject,
                                    tokenAmount: TokenConsumerService.apiCallTokenAmount,
                                    timestamp: new Date().toISOString(),
                                    metadata: {
                                        tokenType: TokenType.apiCall,
                                        uuid: TokenRegisterInterceptor.getRequestIdentifier(req),
                                    },
                                });
                                TokenConsumerService.registerToken(
                                    meteringcoToken,
                                    this.influxService,
                                    this.environmentService,
                                ).catch((e) => {
                                    TokenRegisterInterceptor.logger.error('Failed to register api call token', e);
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
     * Identifies the served request. When the caller, or the infrastructure in front of us, identifies the
     * request then that identifier is used, so a request handed to us twice is only ever recorded once.
     */
    public static getRequestIdentifier(req): string {
        return (
            req?.headers?.['x-request-id'] ||
            req?.headers?.['x-amzn-requestid'] ||
            req?.headers?.['x-amzn-trace-id'] ||
            req?.headers?.['uniqueid'] ||
            req?.id ||
            randomUUID()
        );
    }
}
