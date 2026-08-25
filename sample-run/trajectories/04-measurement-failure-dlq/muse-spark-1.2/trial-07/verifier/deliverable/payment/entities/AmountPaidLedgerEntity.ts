import { InfluxService } from '../../influx/influx.service.js';
import { Point } from '@influxdata/influxdb-client';
import { AmountPaidTransaction } from '../dto/createPayment.dto.js';

export class AmountPaidLedgerEntity {
    public static _measurement = 'amountLedgerPaid';
    public businessID: string;
    public invoiceId: string;
    public customerId: string;
    public transactionAmount: number;
    public timestamp: Date;
    public metadata: Record<string, string>;

    constructor({ invoiceId, transactionAmount, timestamp, metadata, businessID, customerId }: AmountPaidTransaction) {
        this.invoiceId = invoiceId;
        this.transactionAmount = transactionAmount;
        this.timestamp = timestamp ? new Date(timestamp) : new Date();
        this.metadata = metadata;
        this.businessID = businessID;
        this.customerId = customerId;
    }

    public static transform(amountPaidLedgerEntity: AmountPaidLedgerEntity, influxService: InfluxService): Point[] {
        const amountPaidLedgerPoint = influxService.getPoint(AmountPaidLedgerEntity._measurement);

        amountPaidLedgerPoint.tag('invoiceId', amountPaidLedgerEntity.invoiceId);
        amountPaidLedgerPoint.tag('customerId', amountPaidLedgerEntity.customerId);
        amountPaidLedgerPoint.tag('businessID', amountPaidLedgerEntity.businessID);
        amountPaidLedgerPoint.floatField('transactionAmount', amountPaidLedgerEntity.transactionAmount);
        if (amountPaidLedgerEntity?.metadata) {
            Object.keys(amountPaidLedgerEntity.metadata).forEach((key) => {
                amountPaidLedgerPoint.tag(`metadata_${key}`, amountPaidLedgerEntity.metadata[key]);
            });
        }
        amountPaidLedgerPoint.timestamp(amountPaidLedgerEntity.timestamp);
        return [amountPaidLedgerPoint];
    }

    public static async getAmountPaidLedger({
        influxService,
        invoiceId,
        businessID,
    }: {
        influxService: InfluxService;
        invoiceId: string;
        businessID: string;
    }): Promise<AmountPaidLedgerEntity[]> {
        const results = await influxService.getAmountPaidLedger({ invoiceId, businessID });

        return results
            .map((result) => {
                const {
                    _time,
                    _value,
                    invoiceId: resultInvoiceId,
                    businessID: resultBusinessID,
                    customerId,
                    ...rest
                } = result;
                const metadata = Object.keys(rest)
                    .filter((key) => /metadata_/.test(key))
                    .reduce((acc, key) => {
                        if (key.split('metadata_')[1] !== '') {
                            acc[key.split('metadata_')[1]] = rest[key];
                        }
                        return acc;
                    }, {});
                return new AmountPaidLedgerEntity({
                    timestamp: _time,
                    transactionAmount: _value,
                    invoiceId: resultInvoiceId,
                    businessID: resultBusinessID,
                    customerId,
                    metadata,
                });
            })
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    public static async sumLedgerAmountPaidByInvoiceId({
        invoiceId,
        businessID,
        influxService,
    }: {
        invoiceId: string;
        businessID: string;
        influxService: InfluxService;
    }): Promise<number> {
        const results = await influxService.sumAmountPaidLedger({ invoiceId, businessID });

        return results.length ? parseFloat(results[0]._value.toFixed(2)) : 0;
    }
    public static async sumLedgerAmountPaidByCustomerId({
        customerId,
        businessID,
        influxService,
    }: {
        customerId: string;
        businessID: string;
        influxService: InfluxService;
    }): Promise<Record<string, number>> {
        const results = await influxService.sumAmountPaidLedgerbyCustomerId({ customerId, businessID });
        // return an object where the key is the invoiceId, and the value is the amount paid
        return results.reduce((acc, result) => {
            acc[result?.invoiceId] = parseFloat(result._value.toFixed(2));
            return acc;
        }, {});
    }
}
