import { Point } from '@influxdata/influxdb-client';
import { MeteringCoToken } from '../dto/meteringcoToken.dto';
import { MeteringCoTokenMetadata } from '../dto/MeteringCoTokenMetadata';
import { InfluxService } from '../../influx/influx.service.js';
import { MeasurementFormat } from '../../measurement-config/entities/measurement.interface.js';
import { UsageEntity } from '../../usage/entities/usage.entity.js';

export class TokenConsumer {
    public static _measurement = 'tokenConsumer';
    saasCustomerBusinessID: string;
    customerId: string;
    saasCustomerAssociatedBusinessID: string;
    dimensionId?: string;
    tokenAmount: string;
    timestamp: string;
    metadata?: MeteringCoTokenMetadata;

    constructor(
        meteringcoToken: MeteringCoToken,
        customerId: string,
        saasCustomerAssociatedBusinessID: string,
        dimensionId?: string,
    ) {
        if (meteringcoToken) {
            this.saasCustomerBusinessID = meteringcoToken.businessID;
            this.tokenAmount = meteringcoToken.tokenAmount;

            if (meteringcoToken.metadata) {
                this.metadata = meteringcoToken.metadata;
            }
            this.timestamp = meteringcoToken.timestamp;
            this.saasCustomerAssociatedBusinessID = saasCustomerAssociatedBusinessID;
            this.customerId = customerId;
            if (dimensionId) {
                this.dimensionId = dimensionId;
            }
        }
    }

    /**
     * Transforms a token consumer record into the generic measurement shape used across the platform.
     * The identity of the record is the meteringco customer, the meteringco dimension, the meteringco businessID and
     * whatever identifying metadata came in with the token. The timestamp is *always* the moment the
     * metered event happened, never the moment we happened to hear about it. That is what makes
     * duplicate (at least once) deliveries collapse onto a single record and what keeps a late arrival
     * inside the period it actually belongs to.
     */
    static toMeasurementFormat(tokenConsumer: TokenConsumer, measurement: string): MeasurementFormat {
        return {
            _measurement: measurement,
            customerId: tokenConsumer?.customerId,
            dimensionId: tokenConsumer?.dimensionId,
            businessID: tokenConsumer?.saasCustomerAssociatedBusinessID,
            recordValue:
                typeof tokenConsumer?.tokenAmount === 'number'
                    ? tokenConsumer?.tokenAmount
                    : parseFloat(tokenConsumer?.tokenAmount),
            timestamp: tokenConsumer?.timestamp ? tokenConsumer.timestamp : new Date().toISOString(),
            metadata: tokenConsumer?.metadata,
        };
    }

    /**
     * The point written into the token aggregate bucket when a single api call is registered.
     */
    static getPointForm(tokenConsumer: TokenConsumer, influxService: InfluxService): Point {
        return MeasurementFormat.getPointForm(
            TokenConsumer.toMeasurementFormat(tokenConsumer, TokenConsumer._measurement),
            influxService,
        );
    }

    /**
     * The billable usage record written against meteringco's own account for an already aggregated token.
     */
    static getBillableUsageForm(tokenConsumer: TokenConsumer): MeasurementFormat {
        return TokenConsumer.toMeasurementFormat(tokenConsumer, UsageEntity._measurement);
    }
    static getBillableUsagePointForm(tokenConsumer: TokenConsumer, influxService: InfluxService): Point {
        return MeasurementFormat.getPointForm(TokenConsumer.getBillableUsageForm(tokenConsumer), influxService);
    }
}
