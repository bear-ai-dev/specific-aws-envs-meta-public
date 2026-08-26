import { MeasurementFormat } from '../../measurement-config/entities/measurement.interface';
import { StandardMeasurementEntity } from '../../measurement-config/entities/standardMeasurement.entity';
import { UsageEntity } from '../../usage/entities/usage.entity';
import { MeteringCoToken } from '../dto/meteringcoToken.dto';
import { MeteringCoTokenMetadata } from 'token-consumer/dto/MeteringCoTokenMetadata';

export class TokenConsumer {
    public static _measurement = 'tokenConsumer';
    public static meteringcoDogFoodProductionBusinessID = 'meteringco-production';
    public static meteringcoDogFoodSandboxBusinessID = 'meteringco-sandbox';
    public static productionDimensionId = '697f07d0-3180-4351-bdff-7ca029e6c18d';
    public static sandboxDimensionId = '00abdf4f-f975-41c6-8293-76ba09a5cb23';
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
    static tokenConsumerToStandardMeasurementEntity(tokenConsumer: TokenConsumer): MeasurementFormat {
        return {
            businessID:
                tokenConsumer?.saasCustomerAssociatedBusinessID === TokenConsumer.meteringcoDogFoodProductionBusinessID
                    ? TokenConsumer.meteringcoDogFoodProductionBusinessID
                    : TokenConsumer.meteringcoDogFoodSandboxBusinessID,
            customerId: tokenConsumer.customerId,
            recordValue: parseFloat(tokenConsumer.tokenAmount),
            timestamp: tokenConsumer.timestamp,
            metadata: tokenConsumer.metadata,
            _measurement: TokenConsumer._measurement,
            dimensionId:
                tokenConsumer?.saasCustomerAssociatedBusinessID === TokenConsumer.meteringcoDogFoodProductionBusinessID
                    ? TokenConsumer.productionDimensionId
                    : TokenConsumer.sandboxDimensionId,
        };
    }
    static publish(tokenConsumer: TokenConsumer) {
        const { tokenAmount, metadata, customerId, timestamp } = tokenConsumer;
        const entity = new StandardMeasurementEntity({
            timestamp,
            recordValue: parseFloat(tokenAmount),
            _measurement: UsageEntity._measurement,
            businessID:
                tokenConsumer?.saasCustomerAssociatedBusinessID === TokenConsumer.meteringcoDogFoodProductionBusinessID
                    ? TokenConsumer.meteringcoDogFoodProductionBusinessID
                    : TokenConsumer.meteringcoDogFoodSandboxBusinessID,
            customerId,
            metadata: metadata,
            dimensionId:
                tokenConsumer?.saasCustomerAssociatedBusinessID === TokenConsumer.meteringcoDogFoodProductionBusinessID
                    ? TokenConsumer.productionDimensionId
                    : TokenConsumer.sandboxDimensionId,
        });
        StandardMeasurementEntity.publish(entity);
    }
}
