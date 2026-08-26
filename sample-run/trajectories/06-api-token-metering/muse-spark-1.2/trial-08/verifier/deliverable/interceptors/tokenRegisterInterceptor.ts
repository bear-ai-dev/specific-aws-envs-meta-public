import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
import { TokenType } from '../token-consumer/dto/TokenType';
import { TokenConsumer } from '../token-consumer/entities/token-consumer.entity';
import { TokenConsumerAsyncProcessor } from '../token-consumer/token-consumer-async-processor';
import { randomUUID } from 'crypto';

@Injectable()
export class TokenRegisterInterceptor implements NestInterceptor {
    static logger = new Logger(TokenRegisterInterceptor.name);
    environmentService: EnvironmentService;
    influxService: InfluxService;
    constructor() {
        this.environmentService = new EnvironmentService(new InfluxService());
        this.influxService = new InfluxService();
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
                                // Record api call - must not add round trip, so use flush false and fire-and-forget
                                const isProd = dogfoodCustomerDataRes.meteringcoCustomer.businessID === 'meteringco-production';
                                const targetBusinessID = isProd ? 'meteringco-production' : 'meteringco-sandbox';
                                const dimensionId = isProd ? '697f07d0-3180-4351-bdff-7ca029e6c18d' : '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                                const point = this.influxService.getPoint(TokenConsumer._measurement);
                                point.tag('businessID', targetBusinessID);
                                point.tag('customerId', dogfoodCustomerDataRes.meteringcoCustomerId);
                                point.tag('dimensionId', dimensionId);
                                point.tag('metadata_tokenType', JSON.stringify(TokenType.apiCall));
                                point.tag('metadata_uuid', JSON.stringify(randomUUID()));
                                point.floatField('recordValue', 0.001);
                                point.timestamp(new Date());
                                // Fire and forget - do not await to avoid adding round trip
                                void this.influxService.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, process.env.INFLUX_ORG, [point], false).catch((e) => {
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
