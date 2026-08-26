import { InfluxDB, Point, WriteApi } from '@influxdata/influxdb-client';
import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { TokenConsumerService } from '../token-consumer/token-consumer.service';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface';
import { TokenConsumer } from '../token-consumer/entities/token-consumer.entity';
import { MeteringCoToken } from '../token-consumer/dto/meteringcoToken.dto';
import { TokenType } from '../token-consumer/dto/TokenType';
import { TokenConsumerAsyncProcessor } from '../token-consumer/token-consumer-async-processor';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { EnvironmentService } from '../users/users.service';
import { InfluxService } from '../influx/influx.service';
const FIVE_MINUTES_IN_MS = 300000;

@Injectable()
export class TokenRegisterInterceptor implements NestInterceptor {
    static logger = new Logger(TokenRegisterInterceptor.name);
    private static url: string;
    token: string;
    org: string;
    bucket = TokenConsumerAsyncProcessor.tokenAggregateBucket;
    dbclient: InfluxDB;
    writeApi: WriteApi;
    environmentService: EnvironmentService;
    constructor() {
        this.token = process.env.INFLUX_TOKEN || '';
        this.org = process.env.INFLUX_ORG || 'meteringco';
        TokenRegisterInterceptor.url = process.env.INFLUX_URL || 'https://us-east-1-1.aws.cloud2.influxdata.com';
        this.dbclient = new InfluxDB({ url: TokenRegisterInterceptor.url, token: this.token, timeout: 60000 }); // 60 second timeout for requests});
        this.writeApi = this.dbclient.getWriteApi(this.org, this.bucket);
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
                                const { saasCustomerAssociatedBusinessID, meteringcoCustomerId } = dogfoodCustomerDataRes;
                                const measurementFormat: MeasurementFormat =
                                    TokenConsumer.tokenConsumerToStandardMeasurementEntity(
                                        new TokenConsumer(
                                            new MeteringCoToken({
                                                businessID,
                                                tokenAmount: '0.001',
                                                metadata: {
                                                    tokenType: TokenType.apiCall,
                                                    uuid: randomUUID(),
                                                },
                                            }),
                                            meteringcoCustomerId,
                                            saasCustomerAssociatedBusinessID,
                                        ),
                                    );
                                const point = MeasurementFormat.getPointForm(
                                    measurementFormat,
                                    null,
                                    new Point(TokenConsumer._measurement),
                                );
                                TokenRegisterInterceptor.logger.debug(`TokenRegisterInterceptor loading point`);
                                this.writeApi.writePoint(point);
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
