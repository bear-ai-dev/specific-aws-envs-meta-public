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
            // eslint-disable-next-line no-await-in-loop
            const usageOverrides = await this.readUsage({ catalogue, offering, customerId });
            const offeringInstance = Offering.getInstance(
                offering,
                customerId,
                businessID,
                undefined,
                catalogue.settings,
                undefined,
                undefined,
                undefined,
                usageOverrides,
            );
            const lineItems = new InvoiceLineItems();
            // eslint-disable-next-line no-await-in-loop
            await Offering.getLineItemsForUsage({
                startDate,
                endDate,
                lineItems,
                negative: false,
                businessID,
                customerId,
                customerService: undefined,
                dimensions: offering.dimensions,
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

    /**
     * The aggregated usage the metric store holds for one customer over the
     * invoiced period, one entry per dimension the offering carries.
     */
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
            // eslint-disable-next-line no-await-in-loop
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
