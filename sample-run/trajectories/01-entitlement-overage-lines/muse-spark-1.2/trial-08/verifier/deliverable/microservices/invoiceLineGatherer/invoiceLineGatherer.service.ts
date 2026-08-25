import { Logger } from '@nestjs/common';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { AggregatedUsageResponse } from '../../customer/dto/read-customer.dto.js';
import { InvoiceLineItems } from '../../invoice/entities/invoice.entity.js';
import { Offering } from '../../offering/entities/offeringPackage.entity.js';
import { ReadOfferingResponseData } from '../../offering/dto/readOffering.dto.js';
import { getMetricSeries } from '../../utils/aws/cloudwatch.js';
import { getDocument } from '../../utils/aws/s3.js';
import { BillingCatalogue, CustomerInvoiceLines, InvoiceLineGathererDto } from './dto/invoiceLineGatherer.dto.js';

export const meteredInvoiceLines = 'meteredInvoiceLines';

@Processor('scheduler_billing_queue')
export class InvoiceLineGathererService {
    private static readonly logger = new Logger(InvoiceLineGathererService.name);

    @Process(meteredInvoiceLines)
    async readOperationJob({ data: { scheduleParameters, businessID } }: Job<SchedulerEntity>) {
        const { catalogueBucket, catalogueKey, periodStart, periodEnd } = scheduleParameters as InvoiceLineGathererDto;
        InvoiceLineGathererService.logger.log(
            `Assembling metered invoice lines for ${businessID} from ${catalogueBucket}/${catalogueKey}`,
        );
        return this.gatherInvoiceLines({
            businessID,
            catalogueBucket,
            catalogueKey,
            periodStart,
            periodEnd,
        });
    }

    async gatherInvoiceLines({
        businessID,
        catalogueBucket,
        catalogueKey,
        periodStart,
        periodEnd,
    }: {
        businessID: string;
        catalogueBucket: string;
        catalogueKey: string;
        periodStart?: string;
        periodEnd?: string;
    }): Promise<Array<CustomerInvoiceLines>> {
        const catalogue = await getDocument<BillingCatalogue>(catalogueBucket, catalogueKey);
        const startDate = new Date(periodStart ?? catalogue.periodStart);
        const endDate = new Date(periodEnd ?? catalogue.periodEnd);
        const offerings = (catalogue.offerings ?? []).reduce(
            (acc, offering) => {
                acc[offering.offeringId] = offering;
                return acc;
            },
            {} as Record<string, ReadOfferingResponseData>,
        );

        const assembled: Array<CustomerInvoiceLines> = [];
        for (const { customerId, offeringId } of catalogue.enrolments ?? []) {
            const offering = offerings[offeringId];
            if (!offering) {
                InvoiceLineGathererService.logger.warn(
                    `Customer ${customerId} is enrolled in ${offeringId}, which the catalogue does not describe`,
                );
                continue;
            }
            const rawUsage = await this.readUsage({ catalogue, offering, customerId });
            const filteredDimensions: ReadOfferingResponseData['dimensions'] = [];
            const adjustedUsage: Array<AggregatedUsageResponse> = [];
            for (const dimension of offering.dimensions ?? []) {
                const usageEntry = rawUsage.find((u) => u.dimensionId === dimension.dimensionId);
                const totalStr = Offering.billableTotal(usageEntry ? usageEntry.usage : []);
                const totalNum = parseFloat(totalStr);
                let owed: number;
                const entitlement = (dimension as any).usageEntitlement;
                const overageAllowed = (dimension as any).overageAllowed;
                const isInf = entitlement === 'inf';
                const hasFiniteEntitlement = entitlement !== undefined && entitlement !== null && entitlement !== 'inf';
                if (isInf) {
                    owed = 0;
                } else if (hasFiniteEntitlement) {
                    const entNum = typeof entitlement === 'string' ? parseFloat(entitlement) : Number(entitlement);
                    if (totalNum <= entNum) {
                        owed = 0;
                    } else {
                        const overageTrue = overageAllowed === 'true' || overageAllowed === true;
                        if (overageTrue) {
                            owed = totalNum - entNum;
                            owed = parseFloat(owed.toFixed(2));
                        } else {
                            owed = 0;
                        }
                    }
                } else {
                    owed = totalNum;
                }
                const priceStr = (dimension as any).consumptionPrice;
                const priceZero = priceStr !== undefined && priceStr !== null && parseFloat(priceStr) === 0;
                const hideFree = catalogue.settings?.freeDimensionOnInvoice === 'hide';
                let include = false;
                if (owed > 0) {
                    include = true;
                } else if (priceZero && !hideFree) {
                    include = true;
                }
                if (include) {
                    filteredDimensions.push(dimension);
                    adjustedUsage.push({
                        offeringId: offering.offeringId,
                        dimensionId: dimension.dimensionId,
                        usage: [
                            {
                                value: owed.toFixed(2),
                                startTime: new Date(catalogue.periodStart).toISOString(),
                                endTime: new Date(catalogue.periodEnd).toISOString(),
                            },
                        ],
                    });
                }
            }
            const offeringInstance = Offering.getInstance(
                offering,
                customerId,
                businessID,
                undefined,
                catalogue.settings,
                undefined,
                undefined,
                undefined,
                adjustedUsage,
            );
            const lineItems = new InvoiceLineItems();
            await Offering.getLineItemsForUsage({
                startDate,
                endDate,
                lineItems,
                negative: false,
                businessID,
                customerId,
                customerService: undefined,
                dimensions: filteredDimensions,
                offeringInstance,
            });
            assembled.push({
                customerId,
                offeringId,
                offeringName: offering.offeringName,
                lineItems: lineItems.getLineItems(),
            });
        }
        InvoiceLineGathererService.logger.log(`Assembled invoice lines for ${assembled.length} customers`);
        return assembled;
    }

    private async readUsage({
        catalogue,
        offering,
        customerId,
    }: {
        catalogue: BillingCatalogue;
        offering: ReadOfferingResponseData;
        customerId: string;
    }): Promise<Array<AggregatedUsageResponse>> {
        const startTime = new Date(catalogue.periodStart);
        const endTime = new Date(catalogue.periodEnd);
        const series: Array<AggregatedUsageResponse> = [];
        for (const dimension of offering.dimensions ?? []) {
            const readings = await getMetricSeries({
                namespace: catalogue.usageNamespace,
                metricName: catalogue.usageMetricName,
                dimensions: {
                    BusinessId: catalogue.businessID,
                    CustomerId: customerId,
                    DimensionId: dimension.dimensionId,
                },
                startTime,
                endTime,
                period: catalogue.usagePeriod,
            });
            series.push({
                offeringId: offering.offeringId,
                dimensionId: dimension.dimensionId,
                usage: readings.map(({ timestamp, value }) => ({
                    value: value.toString(),
                    startTime: timestamp,
                    endTime: timestamp,
                })),
            });
        }
        return series;
    }

    @OnQueueFailed({ name: meteredInvoiceLines })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to assemble metered invoice lines',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
}
