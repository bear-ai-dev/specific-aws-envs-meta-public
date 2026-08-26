import { Point } from '@influxdata/influxdb-client';
import { MeteringCoToken } from '../dto/meteringcoToken.dto';
import { MeteringCoTokenMetadata } from 'token-consumer/dto/MeteringCoTokenMetadata';
import { MeasurementFormat } from '../../measurement-config/entities/measurement.interface';
import { InfluxService } from '../../influx/influx.service';

export class TokenConsumer {
    public static _measurement = 'tokenConsumer';
    saasCustomerBusinessID: string;
    customerId: string;
    saasCustomerAssociatedBusinessID: string;
    tokenAmount: string;
    timestamp: string;
    metadata?: MeteringCoTokenMetadata;

    constructor(meteringcoToken: MeteringCoToken, customerId: string, saasCustomerAssociatedBusinessID: string) {
        if (meteringcoToken) {
            this.saasCustomerBusinessID = meteringcoToken.businessID;
            this.tokenAmount = meteringcoToken.tokenAmount;

            if (meteringcoToken.metadata) {
                this.metadata = meteringcoToken.metadata;
            }
            this.timestamp = meteringcoToken.timestamp;
            this.saasCustomerAssociatedBusinessID = saasCustomerAssociatedBusinessID;
            this.customerId = customerId;
        }
    }

    /**
     * Maps a token onto the standard measurement shape used for every metered document in the
     * platform. The `businessID`/`dimensionId` are the meteringco (dogfood) account and dimension the
     * token is metered against, and the `timestamp` is always the moment the token happened at,
     * never the moment it was handed to us.
     */
    static toMeasurementFormat(
        tokenConsumer: TokenConsumer,
        {
            businessID,
            dimensionId,
            measurement = TokenConsumer._measurement,
        }: { businessID: string; dimensionId: string; measurement?: string },
    ): MeasurementFormat {
        return {
            timestamp: tokenConsumer?.timestamp ? tokenConsumer.timestamp : new Date().toISOString(),
            customerId: tokenConsumer?.customerId,
            dimensionId,
            businessID,
            recordValue: parseFloat(tokenConsumer?.tokenAmount),
            metadata: tokenConsumer?.metadata,
            _measurement: measurement,
        };
    }

    /**
     * Converts a token into the influx point form of the token, the point is identified by its
     * series (customer, dimension, account and metadata) and its own timestamp. That makes writing
     * the very same token twice idempotent, no matter how much time passed between the two writes.
     */
    static transformer(
        tokenConsumer: TokenConsumer,
        influxService: InfluxService,
        options: { businessID: string; dimensionId: string; measurement?: string },
    ): Array<Point> {
        return [
            MeasurementFormat.getPointForm(TokenConsumer.toMeasurementFormat(tokenConsumer, options), influxService),
        ];
    }
}
