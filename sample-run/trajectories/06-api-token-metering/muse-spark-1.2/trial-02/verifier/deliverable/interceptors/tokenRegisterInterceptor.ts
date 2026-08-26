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
                    // fire-and-forget: must not add round-trip to request
                    void this.recordCall(context).catch((e) => {
                        TokenRegisterInterceptor.logger.error('Failed to record api call', e);
                    });
                }),
            );
        } catch (e) {
            TokenRegisterInterceptor.logger.error('Failed to load tokens', e);
            return next.handle();
        }
    }

    private async recordCall(context: ExecutionContext): Promise<void> {
        try {
            const req = context.switchToHttp().getRequest();
            const res = context.switchToHttp().getResponse();
            if (!res || res.statusCode >= 400) return;
            const businessID = req?.user?.businessID || req?.body?.businessID;
            const subject = req?.user?.sub || req?.body?.subject;
            if (!businessID) return;

            const dogfoodCustomerDataRes = await TokenConsumerService.getMeteringCoCustomerId(
                businessID,
                subject,
                this.environmentService,
            );
            if (!dogfoodCustomerDataRes) {
                TokenRegisterInterceptor.logger.debug(`No meteringco customer for businessID ${businessID}`);
                return;
            }
            const { meteringcoCustomerId, saasCustomerAssociatedBusinessID, meteringcoCustomer } = dogfoodCustomerDataRes;

            // Resolve dimensionId for platform metering
            let dimensionId: string | undefined;
            // Try from meteringcoCustomer offering dimensions if available
            const offering: any = (meteringcoCustomer as any)?.offering;
            if (offering?.dimensions && Array.isArray(offering.dimensions)) {
                const found = offering.dimensions.find((d: any) => d.dimensionId);
                if (found) dimensionId = found.dimensionId;
                // prefer apiCall dimension if identifiable
                const apiCallDim = offering.dimensions.find((d: any) => d.dimensionId === '697f07d0-3180-4351-bdff-7ca029e6c18d' || d.dimensionId === '00abdf4f-f975-41c6-8293-76ba09a5cb23');
                if (apiCallDim) dimensionId = apiCallDim.dimensionId;
            }
            // Fallback to known map
            if (!dimensionId) {
                if (saasCustomerAssociatedBusinessID === 'meteringco-production') {
                    dimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
                } else if (saasCustomerAssociatedBusinessID === 'meteringco-sandbox') {
                    dimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
                } else {
                    // try to infer from existing bucket data by querying
                    try {
                        const queryApi = this.influxService.dbclient.getQueryApi(this.influxService.org);
                        const q = `from(bucket: "${TokenConsumerAsyncProcessor.tokenAggregateBucket}") |> range(start: 1970-01-01T00:00:00Z) |> filter(fn: (r) => r["_measurement"] == "${TokenConsumer._measurement}") |> filter(fn: (r) => r["customerId"] == "${meteringcoCustomerId}") |> limit(n:1)`;
                        const rows: any[] = await queryApi.collectRows(q);
                        if (rows.length && rows[0].dimensionId) dimensionId = rows[0].dimensionId;
                    } catch (_) {}
                }
                if (!dimensionId) {
                    dimensionId = saasCustomerAssociatedBusinessID === 'meteringco-sandbox' ? '00abdf4f-f975-41c6-8293-76ba09a5cb23' : '697f07d0-3180-4351-bdff-7ca029e6c18d';
                }
            }

            // Extract amount, moment, metadata from the call
            // Call may be in req.body as MeteringCoToken or as raw fields
            const body = req?.body || {};
            let amount: string | number | undefined = body.tokenAmount ?? body.amount ?? body.recordValue ?? body.value;
            let recordValue: number;
            if (amount === undefined || amount === null || String(amount).trim() === '') {
                recordValue = 0.001;
            } else {
                recordValue = parseFloat(String(amount));
                if (isNaN(recordValue)) recordValue = 0.001;
            }
            // But if amount provided as 0.001 already, keep it

            let timestamp: string = body.timestamp ?? body.moment ?? body.time ?? body._time ?? new Date().toISOString();
            // Validate timestamp
            if (isNaN(new Date(timestamp).getTime())) timestamp = new Date().toISOString();

            let metadata = body.metadata || {};
            // identifying metadata - uuid
            let uuid: string = metadata.uuid ?? metadata.id ?? body.metadata_uuid ?? req.headers?.['x-metadata-uuid'] ?? req.headers?.['x-request-id'] ?? body.uuid;
            if (!uuid) {
                uuid = randomUUID();
            } else {
                uuid = String(uuid);
            }

            // Build point - must be idempotent on same uuid+timestamp+tags due to series_key overwrite
            const point = this.influxService.getPoint(TokenConsumer._measurement);
            point.tag('customerId', meteringcoCustomerId);
            point.tag('businessID', saasCustomerAssociatedBusinessID);
            point.tag('dimensionId', dimensionId);
            point.tag('metadata_tokenType', JSON.stringify(TokenType.apiCall));
            point.tag('metadata_uuid', JSON.stringify(uuid));
            point.floatField('recordValue', recordValue);
            point.timestamp(new Date(timestamp));

            // Must not add round trip: use flush=false and background flush
            await this.influxService.loadPoints(TokenConsumerAsyncProcessor.tokenAggregateBucket, this.influxService.org, [point], false);
            // Schedule async flush without blocking request (fire-and-forget)
            const bucket = TokenConsumerAsyncProcessor.tokenAggregateBucket;
            setTimeout(() => {
                try {
                    const api = (this.influxService as any).writeApis?.[bucket];
                    if (api) api.flush().catch(() => {});
                } catch (_) {}
            }, 0);

            TokenRegisterInterceptor.logger.debug(`Recorded api call for ${meteringcoCustomerId} at ${timestamp} uuid ${uuid}`);
        } catch (e) {
            TokenRegisterInterceptor.logger.error('Failed to record api call', e);
            AuditService.publishEvent({
                data: [e],
                topic: AuditScope.ERROR,
                message: 'Failed to record api call',
            });
        }
    }
}
