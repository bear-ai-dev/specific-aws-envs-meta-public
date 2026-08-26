import { ConflictException, forwardRef, Inject, Injectable } from '@nestjs/common';
import { CustomerService } from '../customer/customer.service.js';
import { InfluxService } from '../influx/influx.service.js';
import { CreateCreditDto } from './dto/create-credit.dto.js';
import { CreditLedgerResponse, ReadCreditBalance, ReadTransactionLedger } from './dto/readCreditBalance.dto.js';
import { AggregatedCreditEntity, CreditEntity } from './entities/credit.entity.js';

@Injectable()
export class CreditService {
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
    ) {}

    async findCreditBalance({ businessID, customerId }, validateCustomer?: boolean): Promise<ReadCreditBalance> {
        if (validateCustomer) {
            await this.customerService.findOne({ customerId, businessID });
        }

        const { balance } = await AggregatedCreditEntity.calculateBalance({
            businessID,
            customerId,
            influxService: this.InfluxService,
        });

        return {
            balance: balance.toString(),
            customerId,
            message: "Successfully retrieved customer's credit balance",
        };
    }
    async findAllCreditBalances({ businessID, customerIds }): Promise<ReadCreditBalance[]> {
        const creditBalances = await AggregatedCreditEntity.calculateBalances({
            businessID,
            influxService: this.InfluxService,
        });
        const mapOfBalances = creditBalances.reduce((acc, { balance, customerId }) => {
            acc[customerId] = balance;
            return acc;
        }, {});
        return customerIds.map((customerId) => ({
            balance: mapOfBalances[customerId] ? mapOfBalances[customerId].toString() : '0',
            customerId,
            message: "Successfully retrieved customer's credit balance",
        }));
    }

    async sumPaidAmountByInvoiceId({ customerId, businessID, invoiceId }): Promise<number> {
        const results = await this.InfluxService.sumAmountPaidByInvoiceId({
            businessID,
            customerId,
            invoiceId,
        });

        return results.length ? Math.abs(results[0]._value) : 0;
    }

    async getCreditLedger({ businessID, customerId }, validateCustomer?: boolean): Promise<CreditLedgerResponse> {
        if (validateCustomer) {
            await this.customerService.findOne({ customerId, businessID });
        }

        const creditEntites = await CreditEntity.getCreditLedger({
            businessID,
            customerId,
            influxService: this.InfluxService,
        });
        return new CreditLedgerResponse({ data: creditEntites, message: 'Found ledger' });
    }
    async create(
        { transactionAmount, businessID, customerId, metadata, timestamp }: CreateCreditDto,
        validateCustomer?: boolean,
    ): Promise<{ message: string; transactionRow: ReadTransactionLedger }> {
        if (validateCustomer) {
            await this.customerService.findOne({ customerId, businessID });
        }
        const entity = new CreditEntity({ businessID, transactionAmount, customerId, metadata, timestamp });
        const { balance } = await this.findCreditBalance({ businessID, customerId }, false);
        if (parseFloat(balance) + parseFloat(transactionAmount) < 0) {
            throw new ConflictException('Cannot create credit transaction that would result in a negative balance');
        }
        const points = CreditEntity.transform({ creditEntity: entity, influxService: this.InfluxService });
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        return {
            message: 'Successfully updated customer credit',
            transactionRow: new ReadTransactionLedger(entity),
        };
    }
}
