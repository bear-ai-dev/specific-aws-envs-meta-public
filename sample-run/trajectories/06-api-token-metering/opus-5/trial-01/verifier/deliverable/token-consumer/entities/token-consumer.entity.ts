import { MeteringCoToken } from '../dto/meteringcoToken.dto.js';
import { MeteringCoTokenMetadata } from '../dto/MeteringCoTokenMetadata.js';

/**
 * MeteringCo meters itself. Every token which is registered, or billed, is attributed to
 * one of MeteringCo's own accounts (a.k.a "dogfood" accounts). Which account is used depends on
 * whether the meteringco customer, which represents the SaaS business inside of MeteringCo, lives in
 * the production, or the sandbox, environment of MeteringCo.
 */
export class MeteringCoAccount {
    /**
     * The businessID of MeteringCo's own account, this is the account which is billed for the platform usage.
     */
    public businessID: string;
    /**
     * The dimension, on MeteringCo's own account, which the platform usage is metered against.
     */
    public dimensionId: string;
    constructor({ businessID, dimensionId }: { businessID: string; dimensionId: string }) {
        this.businessID = businessID;
        this.dimensionId = dimensionId;
    }
}

export class TokenConsumer {
    public static _measurement = 'tokenConsumer';
    /**
     * MeteringCo's own production account, and the dimension which platform usage is metered against.
     */
    public static meteringcoProductionBusinessID = process.env.METERINGCO_PRODUCTION_BUSINESS_ID || 'meteringco-production';
    public static meteringcoProductionDimensionId =
        process.env.METERINGCO_PRODUCTION_DIMENSION_ID || '697f07d0-3180-4351-bdff-7ca029e6c18d';
    /**
     * MeteringCo's own sandbox account, and the dimension which platform usage is metered against.
     */
    public static meteringcoSandboxBusinessID = process.env.METERINGCO_SANDBOX_BUSINESS_ID || 'meteringco-sandbox';
    public static meteringcoSandboxDimensionId =
        process.env.METERINGCO_SANDBOX_DIMENSION_ID || '00abdf4f-f975-41c6-8293-76ba09a5cb23';

    saasCustomerBusinessID: string;
    customerId: string;
    saasCustomerAssociatedBusinessID: string;
    tokenAmount: string;
    timestamp: string;
    metadata?: MeteringCoTokenMetadata;
    /**
     * MeteringCo's own businessID which this token is recorded against.
     */
    businessID: string;
    /**
     * The dimension, on MeteringCo's own account, which this token is recorded against.
     */
    dimensionId: string;

    constructor(meteringcoToken: MeteringCoToken, customerId: string, saasCustomerAssociatedBusinessID: string) {
        if (meteringcoToken) {
            this.saasCustomerBusinessID = meteringcoToken.businessID;
            this.tokenAmount = meteringcoToken.tokenAmount;

            if (meteringcoToken.metadata) {
                this.metadata = meteringcoToken.metadata;
            }
            this.timestamp = meteringcoToken.timestamp ? meteringcoToken.timestamp : new Date().toISOString();
            this.saasCustomerAssociatedBusinessID = saasCustomerAssociatedBusinessID;
            this.customerId = customerId;
            const { businessID, dimensionId } = TokenConsumer.getMeteringCoAccount(saasCustomerAssociatedBusinessID);
            this.businessID = businessID;
            this.dimensionId = dimensionId;
        }
    }
    /**
     * Resolves MeteringCo's own account, and dimension, for a meteringco customer.
     * A meteringco customer which lives in MeteringCo's production environment is billed on the production
     * account and dimension, every other meteringco customer (sandbox) is billed on the sandbox pair.
     */
    public static getMeteringCoAccount(saasCustomerAssociatedBusinessID?: string): MeteringCoAccount {
        if (saasCustomerAssociatedBusinessID === TokenConsumer.meteringcoProductionBusinessID) {
            return new MeteringCoAccount({
                businessID: TokenConsumer.meteringcoProductionBusinessID,
                dimensionId: TokenConsumer.meteringcoProductionDimensionId,
            });
        }
        return new MeteringCoAccount({
            businessID: TokenConsumer.meteringcoSandboxBusinessID,
            dimensionId: TokenConsumer.meteringcoSandboxDimensionId,
        });
    }
    /**
     * The numerical amount of the token, the amount is modeled as a string to avoid precision loss.
     */
    public static getRecordValue(tokenConsumer: { tokenAmount: string | number }): number {
        return typeof tokenConsumer?.tokenAmount === 'number'
            ? tokenConsumer.tokenAmount
            : parseFloat(tokenConsumer?.tokenAmount);
    }
}
