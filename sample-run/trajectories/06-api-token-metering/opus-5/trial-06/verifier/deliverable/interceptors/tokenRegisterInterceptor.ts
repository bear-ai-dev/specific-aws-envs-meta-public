import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { TokenType } from '../token-consumer/dto/TokenType';
import { MeteringCoTokenMetadata } from '../token-consumer/dto/MeteringCoTokenMetadata';
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
                            // The moment the call was served is the moment it is metered at.
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
                                // Serving a request for a tenant is one api call of meteringco's own product.
                                // Nothing is awaited by the request itself, metering may never add a round
                                // trip to the call it describes.
                                await TokenConsumerService.registerToken(
                                    {
                                        businessID,
                                        subject,
                                        timestamp,
                                        tokenAmount: TokenConsumerService.apiCallTokenAmount,
                                        metadata: {
                                            tokenType: TokenType.apiCall,
                                            uuid: TokenRegisterInterceptor.apiCallIdentity(req),
                                        } as MeteringCoTokenMetadata,
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
     * The identity of a served request. Callers which hand a request over more than once identify it,
     * so the same call is never metered twice.
     */
    static apiCallIdentity(req): string {
        const providedId =
            req?.headers?.uniqueid ||
            req?.headers?.uniqueId ||
            req?.headers?.['x-request-id'] ||
            req?.headers?.['x-amzn-trace-id'] ||
            req?.id;
        return providedId ? `${providedId}` : randomUUID();
    }
}
