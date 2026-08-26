import { Point } from '@influxdata/influxdb-client';
import { MeteringCoToken } from '../dto/meteringcoToken.dto';
import { MeteringCoTokenMetadata } from '../dto/MeteringCoTokenMetadata';

/**
 * A single registered unit of MeteringCo's own product.
 *
 * Every token is stored against the meteringco customer which represents the SaaS business
 * making use of the platform. The token is written into the token aggregate bucket at the
 * moment the metered event occurred (never at the moment it was handed over to us), which
 * makes the write naturally idempotent: re-delivering the same event produces the exact same
 * series/timestamp combination and therefore overwrites itself instead of double counting.
 */
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
     * Converts a token into its influx point representation.
     *
     * The point is timestamped with the moment the metered event happened, so late,
     * out of order, or repeated arrivals all land in the period they belong to.
     */
    static getPointForm(
        tokenConsumer: TokenConsumer,
        influxService: { getPoint: (measurement: string) => Point },
        providedPoint?: Point,
    ): Point {
        const point = influxService ? influxService.getPoint(TokenConsumer._measurement) : providedPoint;
        const timestamp = new Date(tokenConsumer.timestamp);
        // The moment the metered event happened is the record, the moment it was handed over is not.
        point.timestamp(Number.isNaN(timestamp.getTime()) ? new Date() : timestamp);
        point.tag('customerId', tokenConsumer.customerId);
        point.tag('businessID', tokenConsumer.saasCustomerAssociatedBusinessID);
        if (tokenConsumer.dimensionId) {
            point.tag('dimensionId', tokenConsumer.dimensionId);
        }
        point.floatField('recordValue', parseFloat(tokenConsumer.tokenAmount));
        if (tokenConsumer?.metadata) {
            Object.keys(tokenConsumer.metadata).forEach((key) => {
                if (tokenConsumer.metadata[key] !== undefined && tokenConsumer.metadata[key] !== null) {
                    point.tag(`metadata_${key}`, JSON.stringify(tokenConsumer.metadata[key]));
                }
            });
        }
        return point;
    }
}
