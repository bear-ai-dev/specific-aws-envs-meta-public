import { Point } from '@influxdata/influxdb-client';
import { MeteringCoToken } from '../dto/meteringcoToken.dto';
import { MeteringCoTokenMetadata } from 'token-consumer/dto/MeteringCoTokenMetadata';
import { InfluxService } from '../../influx/influx.service';

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
            this.dimensionId = dimensionId;
        }
    }

    /**
     * Transforms a registered token into the influx point which is written into the
     * token aggregate bucket.
     *
     * The point is deliberately timestamped with the moment the api call happened
     * (`tokenConsumer.timestamp`) and _never_ with the moment the call was handed over
     * to us. Influx overwrites a point which repeats an existing
     * (measurement, tagset, timestamp), therefore the very same call handed over twice
     * (at-least-once delivery) collapses onto a single record, and a call which arrives
     * late is recorded in the period it actually happened in.
     */
    static transformer(tokenConsumer: TokenConsumer, influxService: InfluxService): Array<Point> {
        const point = influxService.getPoint(TokenConsumer._measurement);
        point.timestamp(new Date(tokenConsumer.timestamp));
        point.tag('customerId', tokenConsumer.customerId);
        if (tokenConsumer.dimensionId) {
            point.tag('dimensionId', tokenConsumer.dimensionId);
        }
        point.tag('businessID', tokenConsumer.saasCustomerAssociatedBusinessID);
        point.floatField('recordValue', parseFloat(tokenConsumer.tokenAmount));
        if (tokenConsumer?.metadata) {
            Object.keys(tokenConsumer.metadata).forEach((key) => {
                if (tokenConsumer.metadata[key] !== undefined && tokenConsumer.metadata[key] !== null) {
                    point.tag(`metadata_${key}`, JSON.stringify(tokenConsumer.metadata[key]));
                }
            });
        }
        // All Entity Transformers should return an array of points, keep logic consistent,
        // even if there is only one element
        return [point];
    }
}
