import { ApiProperty, OmitType } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { CreditEntity } from '../entities/credit.entity.js';

export class ReadCreditBalance extends BasicResponseDTO {
    public customerId: string;
    public balance: string;
    constructor({ customerId, balance }: { customerId: string; balance: string }) {
        super();
        this.customerId = customerId;
        this.balance = balance;
    }
}
export class ReadTransactionLedger extends OmitType(CreditEntity, ['businessID', 'customerId']) {
    /**
     * The amount associated with a specific credit transaction
     * <br><br>
     * Example: `100.00`
     * @example 100.00
     */
    declare transactionAmount: number;
    /**
     * The timestamp associated with a specific credit transaction
     * @example 2021-01-01T00:00:00.000Z
     */
    declare timestamp: Date;
    /**
     * The metadata associated with a specific credit transaction
     * @example {"key": "value"}
     */
    declare metadata: Record<string, string>;
    constructor(creditEntity: CreditEntity) {
        super(creditEntity);
    }
}

export class CreditLedgerResponse extends BasicResponseDTO {
    @ApiProperty({ minimum: 0 })
    data: ReadTransactionLedger[];

    constructor({ data, message }: { data: CreditEntity[]; message: string }) {
        super();
        this.data = data.reduce((acc, { businessID, customerId, ...rest }) => {
            acc.push({ ...rest, transactionAmount: rest?.transactionAmount?.toString() });
            return acc;
        }, []);

        this.message = message;
    }
}

export const enum CreditAggregationMethod {
    NONE = 'none',
}
