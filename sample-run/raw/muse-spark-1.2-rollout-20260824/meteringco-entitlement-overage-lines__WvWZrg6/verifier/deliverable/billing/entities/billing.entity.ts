import { InfluxService } from '../../influx/influx.service.js';
import { ValidBillingCycles } from '../../offering/dto/createOffering.dto.js';
import { DatetimeUtils } from '../../utils/datetime.js';

export enum billingScheduleConsumers {
    billingReport = 'billingReport',
}

export class Billing {
    public static _measurement = 'billingReport';
    public invoiceId: string;
    public businessID: string;
    public customerId: string;
    public startTime: string;
    public endTime: string;
    public billingId: string;
    constructor({ invoiceId, businessID, customerId, startTime, endTime, billingId }: Billing) {
        this.invoiceId = invoiceId;
        this.businessID = businessID;
        this.customerId = customerId;
        this.startTime = startTime;
        this.endTime = endTime;
        this.billingId = billingId;
    }

    public static billingCycleToTimeRange(billingCycle: ValidBillingCycles): {
        startTime: string;
        endTime: string;
        subscriptionStart: string;
        subscriptionEnd: string;
        currentBillingCycleStartTime: string;
        currentBillingCycleEndTime: string;
    } {
        if (billingCycle === ValidBillingCycles.monthly) {
            return {
                startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfLastMonth()).toISOString(),
                endTime: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfLastMonth()).toISOString(),
                subscriptionStart: DatetimeUtils.beginningOfDay(DatetimeUtils.firstDayOfMonth()).toISOString(),
                subscriptionEnd: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()).toISOString(),
                currentBillingCycleStartTime: DatetimeUtils.beginningOfDay(
                    DatetimeUtils.firstDayOfMonth(),
                ).toISOString(),
                currentBillingCycleEndTime: DatetimeUtils.endOfDay(DatetimeUtils.lastDayOfMonth()).toISOString(),
            };
        }
        if (billingCycle === ValidBillingCycles.annualToDate) {
            return {
                startTime: DatetimeUtils.beginningOfDay(DatetimeUtils.lastYearGivenDate(new Date())).toISOString(),
                endTime: DatetimeUtils.endOfDay(DatetimeUtils.yesterday()).toISOString(),
                subscriptionStart: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                subscriptionEnd: DatetimeUtils.beginningOfDay(DatetimeUtils.nextYear()).toISOString(),
                currentBillingCycleStartTime: DatetimeUtils.beginningOfDay(new Date()).toISOString(),
                currentBillingCycleEndTime: DatetimeUtils.beginningOfDay(DatetimeUtils.nextYear()).toISOString(),
            };
        }
    }

    public static transformer(billingEntity: Billing, influxService: InfluxService) {
        const billingEntityPoint = influxService.getPoint(Billing._measurement);

        billingEntityPoint.stringField('billingId', billingEntity.billingId);
        billingEntityPoint.tag('billingId', billingEntity.billingId);
        billingEntityPoint.tag('invoiceId', billingEntity.invoiceId);
        billingEntityPoint.tag('businessID', billingEntity.businessID);
        billingEntityPoint.tag('customerId', billingEntity.customerId);
        billingEntityPoint.tag('startTime', billingEntity.startTime);
        billingEntityPoint.tag('endTime', billingEntity.endTime);

        return billingEntityPoint;
    }

    public static dbModelToEntity(dbModel) {
        return new Billing({
            invoiceId: dbModel.invoiceId,
            businessID: dbModel.businessID,
            customerId: dbModel.customerId,
            startTime: dbModel.startTime,
            endTime: dbModel.endTime,
            billingId: dbModel.billingId,
        });
    }
}
