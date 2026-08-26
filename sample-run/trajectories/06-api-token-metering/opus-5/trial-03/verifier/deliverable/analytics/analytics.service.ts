import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import {
    CostResponse,
    getMonthlyBill,
    getMonthlyCostOfVolumeAndSnapshot,
    getSnapshotCost,
} from '../utils/aws/costExplorer.js';
import { fetch } from 'cross-fetch';
import { InfluxService } from '../influx/influx.service.js';
import { Invoice } from '../invoice/entities/invoice.entity.js';
import { SettingsService } from '../setting/settings.service.js';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { toDateString } from '../utils/shared/dateFormating.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { ReadSettingsResponseData } from '../setting/dto/read-setting.dto.js';
import { ArchiveCostSource, ComputeCostSource, StorageCostSource } from '../setting/dto/update-settings.dto.js';
import { serializeError } from 'serialize-error';
import { cache } from '../cacheStore.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { LedgerType } from '../ledger/dto/ledgerType.js';
import { InvoiceLedgerRow } from '../ledger/entities/ledger.entity.js';
import { CustomerLedgerRow } from '../ledger/entities/CustomerLedgerRow.js';
import { InvoiceStatus } from '../invoice/entities/InvoiceStatus.js';
import { SupportedCurrencies } from '../offering/dto/SupportedCurrencies.js';

const FOURTEEN_DAYS_IN_MS = 14 * 24 * 60 * 60 * 1000;

export class GrossMargin {
    startDate: string;
    endDate: string;
    cost: number;
    revenue: number;
    grossProfit: number;
    grossMargin: number;
}

export type CostSourceFunctionInput = {
    startDate: Date;
    endDate: Date;
    businessID: string;
    creds: AwsCredentialIdentityProvider;
    months: Array<{ startDate: string; endDate: string }>;
    customerIds?: string[];
};

export type ReturnedCostTypes = 'storageCost' | 'computeCost' | 'archiveCost';
export class ContributionMargin {
    startDate: string;
    endDate: string;
    revenue: number;
    storageCost: number;
    archiveCost: number;
    computeCost: number;
    contributionMargin: number;
    totalCost: number;
    variableCost: number;
    fixedCost: number;
    grossProfit: number;
    grossProfitMargin: number;
    contributionPercentage: number;
}
/* https://stackoverflow.com/questions/69635210/typescript-cannot-declare-additional-properties-on-mapped-types
 * For more information on the amalgamation of types below, see the above link
 */
export type CustomerContributionMargin = {
    [costVariable in ReturnedCostTypes]: number;
} & { startDate: string; endDate: string; revenue: number; contributionMargin: number; contributionPercentage: number };
export class EbsSnapshotCost {
    averageUnitCost: number;
}
export type monthlyRevenue = {
    [key: string]: number;
};
export type revenueResponse = {
    startDate: string;
    endDate: string;
    revenue: number;
};
export type monthlyCost = {
    [key: string]: number;
};
export type MonthlyStorageCost = {
    [key: string]: { startDate: string; endDate: string; cost: { ebsVolume?: number; ebsSnapshot?: number } };
};

export type GeneralizedMonthlyCost =
    | {
          costType: 'storage' | 'compute' | 'archive';
      }
    | {
          [key: string]: number;
      };

@Injectable()
export class AnalyticsService {
    private static readonly logger = new Logger(AnalyticsService.name);

    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        @Inject(forwardRef(() => LedgerService)) readonly ledgerService: LedgerService,
        readonly settingsService: SettingsService,
    ) {}

    private async getMonthlyRevenue(
        businessID: string,
        startDate: Date,
        endDate: Date,
        customerId?: string,
    ): Promise<monthlyRevenue> {
        const monthlyRevenue = {};
        let invoices;
        if (customerId) {
            invoices = await this.influxService.getInvoicesForCustomer({
                businessID,
                customerId,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                onlyOpenAndPaid: true,
            });
        } else {
            invoices = await this.influxService.getAllInvoiceRevenue({ businessID, startDate, endDate });
        }
        let eurConversion: number;
        try {
            eurConversion = await AnalyticsService.getExchangeRate({ currency: 'EUR' });
        } catch (e) {
            AnalyticsService.logger.error(e);
            AuditService.publishEvent({ topic: AuditScope.ERROR, message: e.message, data: serializeError(e) });
        }
        if (invoices.length > 0) {
            AnalyticsService.logger.log(`Starting invoice revenue total calculation`);
            AnalyticsService.logger.log(`invoices length: ${invoices.length}`);
            invoices.forEach((invoiceDBModel) => {
                const invoice = Invoice.fromDBModel(invoiceDBModel);
                const { invoiceDate, totalAmountWithoutTax, currency } = invoice;
                const monthKey = toDateString(this.moveToFirstDateOfMonth(invoiceDate.toDateString()));
                let total;
                AnalyticsService.logger.log(
                    `invoiceDate: ${invoiceDate}, monthKey: ${monthKey}, currency: ${currency}`,
                );
                if (currency === 'EUR') {
                    AnalyticsService.logger.log(
                        `totalAmountWithoutTax: ${totalAmountWithoutTax}, eurConversion: ${eurConversion}`,
                    );
                    total = totalAmountWithoutTax * eurConversion;
                } else {
                    total = totalAmountWithoutTax;
                }
                if (!totalAmountWithoutTax || typeof totalAmountWithoutTax !== 'number') {
                    AnalyticsService.logger.warn(`totalAmountWithoutTax is not a number: ${totalAmountWithoutTax}`);
                } else if (monthlyRevenue[monthKey]) {
                    monthlyRevenue[monthKey] += total;
                } else {
                    monthlyRevenue[monthKey] = total;
                }
            });
            AnalyticsService.logger.log(`Finished invoice revenue total calculation`);
            return monthlyRevenue;
        } else {
            return {};
        }
    }
    public async getRevenueForBusiness({ start, end, businessID }): Promise<number> {
        const ledgerOfInvoices = await this.ledgerService.findLedgerByType({
            startDate: start,
            endDate: end,
            businessID,
            type: LedgerType.INVOICE,
            orFilters: {
                invoiceStatus: [InvoiceStatus.OPEN, InvoiceStatus.PAID],
            },
            groupBy: ['invoiceId'],
            uniqueFilters: ['invoiceId'],
        });
        const invoiceLedgerRowArr = ledgerOfInvoices.data as InvoiceLedgerRow[];
        const currencyArr = [SupportedCurrencies.CNY, SupportedCurrencies.EUR, SupportedCurrencies.USD];
        const exchangeRateMap = {};
        await Promise.all(
            currencyArr.map(async (currency) => {
                exchangeRateMap[currency] = await AnalyticsService.getExchangeRate({ currency });
            }),
        );

        const revenue = invoiceLedgerRowArr.reduce((acc, invoice) => {
            let currenyExchangeRate = exchangeRateMap[invoice.currency];
            if (!currenyExchangeRate) {
                currenyExchangeRate = 1;
            }
            const invoiceExchangedValue = invoice.totalAmountWithoutTax * currenyExchangeRate;
            acc += invoiceExchangedValue;
            return acc;
        }, 0);
        return revenue;
    }

    public async getChurnRateForBusiness({ start, end, businessID }): Promise<number> {
        const [startPeriodLedgerOfCustomers, endPeriodLedgerOfCustomers] = await Promise.all([
            this.ledgerService.findLedgerByType({
                startDate: new Date('January 1, 1970 00:00:00').toISOString(),
                endDate: start,
                businessID,
                type: LedgerType.CUSTOMER,
                existsFilters: ['offeringIds'],
                groupBy: ['customerId'],
                uniqueFilters: ['customerId'],
                notExistsFilters: ['softDelete'],
            }),
            this.ledgerService.findLedgerByType({
                startDate: new Date('January 1, 1970 00:00:00').toISOString(),
                endDate: end,
                businessID,
                type: LedgerType.CUSTOMER,
                existsFilters: ['offeringIds'],
                groupBy: ['customerId'],
                uniqueFilters: ['customerId'],
                notExistsFilters: ['softDelete'],
            }),
        ]);

        const startPeriodCustomerLedgerRowArr = startPeriodLedgerOfCustomers.data as CustomerLedgerRow[];
        const endPeriodCustomerLedgerRowArr = endPeriodLedgerOfCustomers.data as CustomerLedgerRow[];
        if (endPeriodCustomerLedgerRowArr && endPeriodCustomerLedgerRowArr.length) {
            return Math.abs(
                (startPeriodCustomerLedgerRowArr.length - endPeriodCustomerLedgerRowArr.length) /
                    endPeriodCustomerLedgerRowArr.length,
            );
        } else {
            return 0;
        }
    }

    public async getNumberOfCustomersForBusiness({ end, businessID }): Promise<number> {
        const res = await this.ledgerService.findLedgerByType({
            startDate: new Date('January 1, 1970 00:00:00').toISOString(),
            endDate: end,
            businessID,
            type: LedgerType.CUSTOMER,
            existsFilters: ['offeringIds'],
            groupBy: ['customerId'],
            uniqueFilters: ['customerId'],
        });
        return res?.data?.length ? res.data.length : 0;
    }
    /**
     * Returns the exchange rate for a given currency to USD,
     * USD is the default currency and will return 1
     *
     */
    static async getExchangeRate({ currency }): Promise<number> {
        if (currency === 'USD' || !currency) {
            return 1;
        } else {
            const cacheValue = await cache.get(currency);
            AnalyticsService.logger.log(`Getting exchange rate for ${currency}, from cache if possible: ${cacheValue}`);
            if (cacheValue) {
                return cacheValue as number;
            } else {
                const res = await fetch(
                    `https://openexchangerates.org/api/latest.json?app_id=${process.env.OPEN_EXCHANGE_RATE_API_KEY}`,
                );

                const { rates } = await res.json();
                const exchangeRate = rates[currency];
                AnalyticsService.logger.log(`Exchange rate for ${currency} is ${exchangeRate}`);
                // Set the exchange rate for 24 hours
                cache.set(currency, exchangeRate, 86400);
                if (!exchangeRate) {
                    throw new BadRequestException(`Invalid currency: ${currency}`);
                }
                return exchangeRate;
            }
        }
    }

    private calculateAverageSnapshotCost(hourlySnapshotCost: CostResponse[]): number {
        const averageSnapshotCost = hourlySnapshotCost.reduce((acc, current) => {
            return acc + current.cost;
        }, 0);
        return averageSnapshotCost / hourlySnapshotCost.length;
    }
    private getLastMonth(time: string) {
        const month = new Date(time);
        month.setDate(0); // 0 will result in the last day of the previous month
        month.setDate(1);
        return month.toISOString();
    }

    private async getMonthlyComputeCost(
        businessID: string,
        startDate: Date,
        endDate: Date,
        customerIds?: string[],
    ): Promise<monthlyCost> {
        const monthlyComputeCost = {};
        let monthlyComputeCostDBModels = [];
        if (customerIds?.length) {
            monthlyComputeCostDBModels = await this.influxService.aggregateMonthlyComputeCostsByCustomer({
                businessID,
                startDate,
                endDate,
                customerIds,
            });
        } else {
            monthlyComputeCostDBModels = await this.influxService.aggregateMonthlyComputeCosts({
                businessID,
                startDate,
                endDate,
            });
        }
        if (monthlyComputeCostDBModels.length > 0) {
            monthlyComputeCostDBModels.forEach((monthlyCostDBModel) => {
                const { _time, _value } = monthlyCostDBModel;

                const monthKey = toDateString(this.moveToFirstDateOfMonth(this.getLastMonth(_time)));
                if (_value) {
                    monthlyComputeCost[monthKey] = _value;
                } else {
                    monthlyComputeCost[monthKey] = 0;
                }
            });
        }
        return monthlyComputeCost;
    }

    /**
     * Move to the 1st day of the month
     */
    // TODO Move to utility folder/class
    private moveToFirstDateOfMonth(dateStr?: string, nextMonth = false): Date {
        const dateObj = new Date(dateStr);
        const y = dateObj.getUTCFullYear();
        const m = dateObj.getUTCMonth() + (nextMonth ? 1 : 0);
        const newDate = new Date(Date.UTC(y, m));
        return newDate;
    }

    private createArrayOfMonthsBetweenDates({
        startDate,
        endDate,
    }: {
        startDate: Date;
        endDate: Date;
    }): Array<{ startDate: string; endDate: string }> {
        // eslint-disable-next-line
        let [a, b] = [startDate.toISOString().slice(0, 10), endDate.toISOString().slice(0, 10)].map((arg) =>
            arg
                .split('-')
                .slice(0, 2)
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                .reduce((y, m) => m - 1 + y * 12),
        );
        // eslint-disable-next-line
        // @ts-ignore
        return Array.from({ length: b - a }, (_) => a++)
            .map((m) => ~~(m / 12) + '-' + ('0' + ((m % 12) + 1)).slice(-2) + '-01')
            .map((date, index, array) => {
                const revenueStart = new Date(date);
                if (index === array.length - 1) {
                    return {
                        startDate: revenueStart.toISOString().slice(0, 10),
                        endDate: endDate.toISOString().slice(0, 10),
                    };
                } else {
                    const revenueEnd =
                        revenueStart.getMonth() == 11
                            ? new Date(revenueStart.getFullYear() + 1, 1, 1)
                            : new Date(revenueStart.getFullYear(), revenueStart.getMonth() + 1, 1);
                    return {
                        startDate: revenueStart.toISOString().slice(0, 10),
                        endDate: revenueEnd.toISOString().slice(0, 10),
                    };
                }
            });
    }
    private async getCredsIfAvailable(
        businessID: string,
        data: ReadSettingsResponseData[],
    ): Promise<AwsCredentialIdentityProvider> {
        try {
            if (data?.length) {
                const [
                    {
                        cloudIAM: { iamRoleArn, externalId },
                    },
                ] = data;

                if (iamRoleArn) {
                    return fromTemporaryCredentials({
                        params: { RoleArn: iamRoleArn, ExternalId: externalId ? externalId : undefined },
                        clientConfig: { region: 'us-east-1' },
                    });
                } else {
                    return null;
                }
            } else {
                return null;
            }
        } catch (e) {
            AuditService.publishEvent({
                message: `Failed to get settings and creds in analytics for ${businessID}`,
                data: [e],
                topic: AuditScope.ERROR,
            });
            return null;
        }
    }
    private calculatePerCustomerContribution({
        revenue,
        months,
        generalizedMonthlyCosts,
    }: {
        months: Array<{ startDate: string; endDate: string }>;
        revenue: monthlyRevenue;
        generalizedMonthlyCosts: GeneralizedMonthlyCost[];
    }): Array<CustomerContributionMargin> {
        return months.map(({ startDate, endDate }) => {
            console.log(startDate, endDate);
            const computeCosts = generalizedMonthlyCosts.find(({ costType }) => costType === 'compute');
            const storageCosts = generalizedMonthlyCosts.find(({ costType }) => costType === 'storage');
            const archiveCosts = generalizedMonthlyCosts.find(({ costType }) => costType === 'archive');

            // analytics
            const variableCost = generalizedMonthlyCosts.reduce((acc, item) => {
                acc += item[startDate] as number;
                return acc;
            }, 0);
            const revenueForMonth = revenue[startDate];
            let contributionMargin;
            let contributionPercentage;
            if (revenueForMonth) {
                contributionMargin = revenueForMonth - variableCost;
                contributionPercentage = contributionMargin / revenueForMonth;
            } else {
                contributionMargin = 0;
                contributionPercentage = 0;
            }
            return {
                startDate,
                endDate,
                revenue: revenueForMonth,
                contributionMargin,
                contributionPercentage,
                computeCost: computeCosts ? computeCosts[startDate] : undefined,
                storageCost: storageCosts ? storageCosts[startDate] : undefined,
                archiveCost: archiveCosts ? archiveCosts[startDate] : undefined,
            };
        });
    }

    async findAll(
        businessID: string,
        metric: string,
        start: string,
        end: string,
        customerId?: string,
    ): Promise<
        Array<
            | ContributionMargin
            | GrossMargin
            | EbsSnapshotCost
            | BasicResponseDTO
            | revenueResponse
            | CustomerContributionMargin
        >
    > {
        const startDate = this.moveToFirstDateOfMonth(start);
        const endDate = end
            ? this.moveToFirstDateOfMonth(end, true)
            : this.moveToFirstDateOfMonth(new Date().toISOString(), true);
        const settingsInformation = await this.settingsService.findAll({ businessID });
        const creds = await this.getCredsIfAvailable(businessID, settingsInformation);
        const [{ storageCostSource, computeCostSource, archiveCostSource }] = settingsInformation;
        const costSourceFunctions = this.getCostSourceFunctions({
            storageCostSource,
            computeCostSource,
            archiveCostSource,
        });
        const months = this.createArrayOfMonthsBetweenDates({ startDate, endDate });
        switch (metric) {
            case 'revenue':
                const revenueResults = await this.getMonthlyRevenue(businessID, startDate, endDate, customerId);
                const validMonths = months.map((dates) => ({
                    ...dates,
                    revenue: 0,
                }));
                Object.entries(revenueResults).forEach(([key, value]) => {
                    const index = validMonths.findIndex((item) => item.startDate === key);
                    if (index > -1) {
                        validMonths[index].revenue = value;
                    }
                });
                return validMonths;

            case 'profitMargin':
                if (!creds) {
                    throw new BadRequestException('IAM role not setup in Settings');
                }

                const monthlyRevenue = await this.getMonthlyRevenue(businessID, startDate, endDate, customerId);
                const monthlyCloudCost = await getMonthlyBill(startDate, endDate, creds);
                const costs = await Promise.all(
                    costSourceFunctions.map(async (sourceFunction) =>
                        sourceFunction({
                            startDate,
                            endDate,
                            businessID,
                            creds: creds,
                            months,
                        }),
                    ),
                );
                const profitMarginResponse = [];
                for (const [monthKey, value] of Object.entries(monthlyCloudCost)) {
                    const { startDate, endDate, bill: totalCost } = value;
                    // revenue
                    const revenue = monthlyRevenue[monthKey] ? monthlyRevenue[monthKey] : 0;
                    const computeCosts = costs.find(({ costType }) => costType === 'compute');
                    const storageCosts = costs.find(({ costType }) => costType === 'storage');
                    const archiveCosts = costs.find(({ costType }) => costType === 'archive');

                    // analytics
                    const variableCost = costs.reduce((acc, item) => {
                        acc += item[monthKey] as number;
                        return acc;
                    }, 0);
                    const fixedCost = totalCost - variableCost;
                    const grossProfit = revenue - totalCost;
                    const grossProfitMargin = grossProfit / revenue;
                    const contributionMargin = revenue - variableCost;
                    const contributionPercentage = contributionMargin / revenue;
                    // prepare response
                    profitMarginResponse.push({
                        startDate,
                        endDate,
                        revenue,
                        totalCost,
                        computeCost: computeCosts ? computeCosts[monthKey] : undefined,
                        storageCost: storageCosts ? storageCosts[monthKey] : undefined,
                        archiveCost: archiveCosts ? archiveCosts[monthKey] : undefined,
                        variableCost,
                        fixedCost,
                        grossProfit,
                        grossProfitMargin,
                        contributionMargin,
                        contributionPercentage,
                    });
                }
                return profitMarginResponse;
            case 'contributionMarginPerCustomer':
                if (!creds) {
                    throw new BadRequestException('IAM role not setup in Settings');
                }
                if (!customerId) {
                    throw new BadRequestException('customerId is required for contributionMargin metric');
                }

                const perCustomerRevenue = await this.getMonthlyRevenue(businessID, startDate, endDate, customerId);
                const perCustomerCosts = await Promise.all(
                    costSourceFunctions.map(async (sourceFunction) =>
                        sourceFunction({
                            startDate,
                            endDate,
                            businessID,
                            creds: creds,
                            customerIds: [customerId],
                            months,
                        }),
                    ),
                );
                return this.calculatePerCustomerContribution({
                    revenue: perCustomerRevenue,
                    months,
                    generalizedMonthlyCosts: perCustomerCosts,
                });
            case 'snapshotCost':
                if (!creds) {
                    throw new BadRequestException('IAM role not setup in Settings');
                }
                const snapshotCostStartDate = new Date(start);
                const snapshotCostEndDate = end ? new Date(end) : new Date();
                const today = new Date();
                const differenceInTime = snapshotCostEndDate.getTime() - snapshotCostStartDate.getTime();

                if (
                    today.getTime() - FOURTEEN_DAYS_IN_MS > snapshotCostStartDate.getTime() ||
                    differenceInTime > FOURTEEN_DAYS_IN_MS
                ) {
                    throw new BadRequestException('Max supported range of snapshot cost is past 14 days');
                }
                const hourlyCostResponse = await getSnapshotCost(creds, snapshotCostStartDate, snapshotCostEndDate);
                return [{ averageUnitCost: this.calculateAverageSnapshotCost(hourlyCostResponse) }];
        }
    }
    getCostSourceFunctions({
        storageCostSource,
        computeCostSource,
        archiveCostSource,
    }: {
        storageCostSource: StorageCostSource;
        computeCostSource: ComputeCostSource;
        archiveCostSource: ArchiveCostSource;
    }): Array<(costSourceFunctionInput: CostSourceFunctionInput) => GeneralizedMonthlyCost> {
        const functionArray = [];
        if (storageCostSource === StorageCostSource.ebs) {
            functionArray.push(
                async ({
                    startDate,
                    endDate,
                    creds,
                    businessID,
                    customerIds = [],
                    months,
                }: CostSourceFunctionInput): Promise<GeneralizedMonthlyCost> => {
                    const results = await getMonthlyCostOfVolumeAndSnapshot({
                        startDate,
                        endDate,
                        creds,
                        businessID,
                        customerIds,
                        months,
                    });
                    AnalyticsService.logger.debug('EBS results', results);
                    // Transform into the correct output format
                    const zeroValuesForMonths = months.reduce((acc, { startDate }) => {
                        acc[startDate] = 0;
                        return acc;
                    }, {});
                    return Object.keys(results).reduce(
                        (acc, item) => {
                            acc[item] = results[item].cost.ebsVolume;
                            return acc;
                        },
                        { costType: 'storage', ...zeroValuesForMonths },
                    );
                },
            );
        }
        if (archiveCostSource === ArchiveCostSource.ebs) {
            functionArray.push(
                async ({
                    startDate,
                    endDate,
                    creds,
                    businessID,
                    customerIds = [],
                    months,
                }: CostSourceFunctionInput): Promise<GeneralizedMonthlyCost> => {
                    const results = await getMonthlyCostOfVolumeAndSnapshot({
                        startDate,
                        endDate,
                        creds,
                        businessID,
                        customerIds,
                        months,
                    });
                    // Transform into the correct output format
                    const zeroValuesForMonths = months.reduce((acc, { startDate }) => {
                        acc[startDate] = 0;
                        return acc;
                    }, {});
                    return Object.keys(results).reduce(
                        (acc, item) => {
                            acc[item] = results[item].cost.ebsSnapshot;
                            return acc;
                        },
                        { costType: 'archive', ...zeroValuesForMonths },
                    );
                },
            );
        }
        if (computeCostSource === ComputeCostSource.eks) {
            functionArray.push(
                async ({
                    startDate,
                    endDate,
                    businessID,
                    customerIds = [],
                    months,
                }: CostSourceFunctionInput): Promise<GeneralizedMonthlyCost> => {
                    const results = await this.getMonthlyComputeCost(businessID, startDate, endDate, [...customerIds]);
                    const zeroValuesForMonths = months.reduce((acc, { startDate }) => {
                        acc[startDate] = 0;
                        return acc;
                    }, {});
                    const resultsLength = Object.keys(results).length;
                    if (resultsLength) {
                        return Object.keys(results).reduce(
                            (acc, item) => {
                                acc[item] = results[item];

                                return acc;
                            },
                            { costType: 'compute', ...zeroValuesForMonths },
                        );
                    } else {
                        return { costType: 'compute', ...zeroValuesForMonths };
                    }
                },
            );
        }

        return functionArray;
    }
}
