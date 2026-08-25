import { Inject, Logger, forwardRef } from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import { InvoicesService } from '../invoice/invoices.service.js';
import { Billing, billingScheduleConsumers } from './entities/billing.entity.js';
import { randomUUID } from 'crypto';
import { Process, Processor } from '@nestjs/bull';
import { CreateBillingReportDto } from './dto/createBillingReport.dto.js';
import { Job } from 'bull';
import { SchedulerEntity } from '../scheduler/entities/scheduler.entity.js';
import { CustomerService } from '../customer/customer.service.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { SettingsService } from '../setting/settings.service.js';
import { InvoiceGeneration } from '../setting/dto/update-settings.dto.js';
import { ContractService } from '../contract/contract.service.js';

@Processor('scheduler_billing_queue')
export class BillingService {
    private static readonly logger = new Logger(BillingService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => ContractService)) readonly contractService: ContractService,
        @Inject(forwardRef(() => InvoicesService)) readonly invoicesService: InvoicesService,
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService,
    ) {}
    @Process({ name: billingScheduleConsumers.billingReport })
    async create({ data: { scheduleParameters, businessID } }: Job<SchedulerEntity>) {
        const { customerId, freeTrialEnd, startDateOverride, endDateOverride, offeringId } =
            scheduleParameters as CreateBillingReportDto;
        BillingService.logger.log(
            `Starting billing report for customer: ${customerId}, Current Time is: ${new Date()}`,
        );
        let setBusinessID = businessID;
        if (!setBusinessID) {
            // change the type of scheduleParameters to CreateBillingReportDto
            const { businessID: schedulerParametersBusinessID } = scheduleParameters as CreateBillingReportDto;
            setBusinessID = schedulerParametersBusinessID;
        }
        try {
            const { data } = await this.customerService.findOne({ businessID: setBusinessID, customerId });
            let offering;
            let startTime;
            let endTime;
            let settingsEntity;
            if (data[0]?.offeringIds && data[0]?.offeringIds.length > 0) {
                const offeringIds = data[0]?.offeringIds;
                const { offering: foundOffering } = await this.contractService.findOne({
                    customerId,
                    businessID: setBusinessID,
                    offeringId: offeringId ? offeringId : offeringIds[offeringIds.length - 1],
                    offeringEnrollmentDate: data[0]?.offeringEnrollmentDate,
                    freeTrialEndDate: data[0]?.freeTrialEndDate,
                });
                offering = foundOffering;
                const { startTime: calcStartTime, endTime: calcEndTime } = Billing.billingCycleToTimeRange(
                    offering.billingCycle,
                );
                startTime = calcStartTime;
                endTime = calcEndTime;
                const [settingsRes] = await this.settingsService.findAll({ businessID: setBusinessID });
                settingsEntity = settingsRes;
            }

            BillingService.logger.log(
                `Processing billing with the following parameters: startDateOverride: ${startDateOverride}, endDateOverride: ${endDateOverride}, freeTrialEnd: ${freeTrialEnd}`,
            );
            let invoiceId;
            if (freeTrialEnd) {
                BillingService.logger.log(`Processing free trial end for customer: ${customerId}`);
                invoiceId = await offering.processFreeTrialEnd({ customer: data[0] });
            } else {
                if (settingsEntity?.invoiceGeneration === InvoiceGeneration.consolidatedPerBillingCycle) {
                    offering.consolidatedInvoice = true;
                }
                invoiceId = await offering.processBilling(
                    startDateOverride ? new Date(startDateOverride) : undefined,
                    endDateOverride ? new Date(endDateOverride) : undefined,
                    data[0],
                    true,
                );
            }

            const entity = new Billing({
                invoiceId,
                businessID: setBusinessID,
                customerId,
                startTime,
                endTime,
                billingId: randomUUID(),
            });
            // 6. Save Billing information to the Ledger
            const point = Billing.transformer(entity, this.InfluxService);
            await this.InfluxService.loadPoints(`${process.env.STAGE}-aggregate-usage`, process.env.INFLUX_ORG, [
                point,
            ]);
            BillingService.logger.log(`Finished billing report for customer: ${customerId}, invoiceId: ${invoiceId}`);
        } catch (error) {
            AuditService.publishEvent({
                message: 'Failed to create billing Invoice',
                topic: AuditScope.ERROR,
                data: [{ error: serializeError(error), customerId, businessID: setBusinessID }],
            });
        }
    }
}
