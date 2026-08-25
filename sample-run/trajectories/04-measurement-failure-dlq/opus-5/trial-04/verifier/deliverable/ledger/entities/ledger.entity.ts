import { ContractEntity } from '../../contract/entities/contract.entity';
import { CustomerEntity } from '../../customer/entities/customer.entity';
import { Invoice } from '../../invoice/entities/invoice.entity';
import { LedgerType } from '../dto/ledgerType';
import { ChildRowEntity, CustomerGroupEntity } from '../../customergroup/entities/customergroup.entity';
import { CustomerLedgerRow } from './CustomerLedgerRow';

export class InvoiceLedgerRow {
    timestamp: string;
    totalAmountWithoutTax: number;
    taxAmount: number;
    invoiceId: string;
    customerId: string;
    isManual: boolean;
    businessID: string;
    currency: string;
    invoiceStatus: string;
    invoiceDate: Date;
}
export class EnrollmentLedgerRow extends ContractEntity {
    timestamp: string;
}
export class CustomerGroupLedgerRow extends CustomerGroupEntity {
    timestamp: string;
}
export class ChildRowLedgerRow extends ChildRowEntity {
    timestamp: string;
}

export class LedgerEntity {
    type: LedgerType;
    data: Array<
        CustomerLedgerRow | InvoiceLedgerRow | EnrollmentLedgerRow | CustomerGroupLedgerRow | ChildRowLedgerRow
    >;
    constructor({ type, influxRows }: { type: LedgerType; influxRows: any[] }) {
        this.type = type;

        if (LedgerType.INVOICE === this.type) {
            this.data = influxRows.map((row: any) => {
                const invoice = Invoice.fromDBModel(row);
                return {
                    totalAmountWithoutTax: invoice?.totalAmountWithoutTax,
                    taxAmount: invoice?.taxAmount,
                    invoiceId: invoice?.invoiceId,
                    customerId: invoice?.customerId,
                    isManual: invoice?.isManual,
                    businessID: invoice?.businessID,
                    currency: invoice?.currency,
                    invoiceStatus: invoice?.invoiceStatus,
                    invoiceDate: invoice?.invoiceDate,
                    timestamp: row._time,
                };
            });
        } else if (LedgerType.CUSTOMER === this.type) {
            this.data = influxRows.map((row: any) => ({
                ...CustomerEntity.dbModelToEntity(row),
                timestamp: row._time,
            }));
        } else if (LedgerType.ENROLLMENT === this.type) {
            this.data = influxRows.map((row: any) => ({
                ...ContractEntity.dbModelToEntity(row),
                timestamp: row._time,
            }));
        } else if (LedgerType.CUSTOMERGROUP === this.type) {
            this.data = influxRows.map((row: any) => ({
                ...CustomerGroupEntity.dbModelToEntity(row),
                timestamp: row._time,
            }));
        } else if (LedgerType.CHILDROW === this.type) {
            this.data = influxRows.map((row: any) => ({
                ...ChildRowEntity.dbModelToEntity(row),
                timestamp: row._time,
            }));
        }
    }

    static typeToMeasurement(type: LedgerType): string {
        switch (type) {
            case LedgerType.INVOICE:
                return Invoice._measurement;
            case LedgerType.CUSTOMER:
                return CustomerEntity._measurement;
            case LedgerType.ENROLLMENT:
                return ContractEntity._measurement;
            case LedgerType.CUSTOMERGROUP:
                return CustomerGroupEntity._measurement;
            case LedgerType.CHILDROW:
                return ChildRowEntity._measurement;
        }
    }
}
