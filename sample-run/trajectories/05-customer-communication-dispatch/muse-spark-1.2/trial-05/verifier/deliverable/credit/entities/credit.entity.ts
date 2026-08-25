import { InfluxService } from '../../influx/influx.service.js';
import { DatetimeUtils } from '../../utils/datetime.js';

export class CreditEntity {
    public static _measurement = 'credit';
    public businessID: string;
    public customerId: string;
    public transactionAmount: number;
    public timestamp: Date;
    public metadata: Record<string, string>;
    constructor({ transactionAmount, timestamp, businessID, customerId, metadata }) {
        this.transactionAmount = transactionAmount;
        this.timestamp = timestamp ? new Date(timestamp) : DatetimeUtils.getCurrentUTCTime();
        this.businessID = businessID;
        this.customerId = customerId;
        this.metadata = metadata;
    }
    public static transform({
        creditEntity,
        influxService,
    }: {
        creditEntity: CreditEntity;
        influxService: InfluxService;
    }) {
        const customerEntityPoint = influxService.getPoint(CreditEntity._measurement);

        customerEntityPoint.tag('customerId', creditEntity.customerId);
        customerEntityPoint.tag('businessID', creditEntity.businessID);
        customerEntityPoint.floatField('transactionAmount', creditEntity.transactionAmount);
        if (creditEntity?.metadata) {
            Object.keys(creditEntity.metadata).forEach((key) => {
                customerEntityPoint.tag(`metadata_${key}`, creditEntity.metadata[key]);
            });
        }
        customerEntityPoint.timestamp(creditEntity.timestamp);

        return [customerEntityPoint];
    }
    public static async getCreditLedger({
        influxService,
        customerId,
        businessID,
    }: {
        influxService: InfluxService;
        customerId: string;
        businessID: string;
    }): Promise<CreditEntity[]> {
        const results = await influxService.getCreditLedger({ customerId, businessID });

        return results
            .map((result) => {
                const { _time, _value, customerId: resultCustomerId, businessID: resultBusinessID, ...rest } = result;
                const metadata = Object.keys(rest)
                    .filter((key) => /metadata_/.test(key))
                    .reduce((acc, key) => {
                        if (key.split('metadata_')[1] !== '') {
                            acc[key.split('metadata_')[1]] = rest[key];
                        }
                        return acc;
                    }, {});
                return new CreditEntity({
                    timestamp: new Date(_time),
                    transactionAmount: _value,
                    customerId: resultCustomerId,
                    businessID: resultBusinessID,
                    metadata,
                });
            })
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }
}

export class AggregatedCreditEntity {
    public businessID: string;
    public customerId: string;
    public balance: number;

    constructor({ businessID, customerId, balance }: AggregatedCreditEntity) {
        this.businessID = businessID;
        this.customerId = customerId;
        this.balance = balance ? parseFloat(balance.toFixed(2)) : 0;
    }

    public static async calculateBalance({
        businessID,
        customerId,
        influxService,
    }: {
        businessID: string;
        customerId: string;
        influxService: InfluxService;
    }): Promise<AggregatedCreditEntity> {
        const results = await influxService.calculateCreditTotal({ businessID, customerId });
        if (results.length) {
            const [{ _value }] = results;
            return new AggregatedCreditEntity({ balance: _value, businessID, customerId });
        } else {
            return new AggregatedCreditEntity({ balance: 0, businessID, customerId });
        }
    }
    public static async calculateBalances({
        businessID,
        influxService,
    }: {
        influxService: InfluxService;
        businessID: string;
    }): Promise<AggregatedCreditEntity[]> {
        const results = await influxService.calculateAllCreditTotal({ businessID });
        if (results.length) {
            return results.map(
                ({ _value, customerId }) => new AggregatedCreditEntity({ balance: _value, businessID, customerId }),
            );
        } else {
            return [];
        }
    }
}
