import { Logger } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { AggregatedUsageResponse } from '../../customer/dto/read-customer.dto.js';
import { overageAllowedEnum } from '../../dimensions/dto/create-dimension.dto.js';
import { ReadDimensionResponseData } from 'dimensions/dto/create-dimension.dto.js';
import { InfluxService } from '../../influx/influx.service.js';
import { ValidBillingCycles } from '../../offering/dto/createOffering.dto.js';
import { Offering, Subscription } from '../../offering/entities/offeringPackage.entity.js';
import { FreeDimensionOnInvoice } from '../../setting/dto/FreeDimensionOnInvoice.js';
import { DatetimeUtils } from '../../utils/datetime.js';

export enum billingScheduleConsumers {
    billingReport = 'billingReport',
}

export class Billing {
    private static readonly logger = new Logger(Billing.name);
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

    public static usageToTotal(
        aggregatedUsageResponse: AggregatedUsageResponse,
        dimension: ReadDimensionResponseData,
    ): string {
        try {
            const { usage, dimensionId } = aggregatedUsageResponse;
            if (dimensionId !== dimension?.dimensionId) {
                throw new Error(
                    `dimensionId for usage data: ${dimensionId} does not match dimensionId on dimension document ${dimension?.dimensionId}`,
                );
            }
            const { usageEntitlement, overageAllowed } = dimension;
            const totalUsage = usage.reduce((acc, { value }) => {
                acc += parseFloat(value);
                return acc;
            }, 0);

            if (!usageEntitlement) {
                const usage = totalUsage;
                return usage.toFixed(2).toString();
            }

            if (usageEntitlement === 'inf') {
                return '0.00';
            } else {
                const usageEntitlementValue = parseFloat(usageEntitlement ? usageEntitlement.toString() : '0');
                const usage = totalUsage - usageEntitlementValue;
                if (usage > 0) {
                    if (
                        overageAllowed !== overageAllowedEnum.false ||
                        overageAllowed === undefined ||
                        overageAllowed === null
                    ) {
                        return usage.toFixed(2).toString();
                    } else {
                        return '0.00';
                    }
                } else {
                    return '0.00';
                }
            }
        } catch (e) {
            Billing.logger.error('error in usageToTotal', e);
            AuditService.publishEvent({ message: 'error in usageToTotal', data: [e], topic: AuditScope.ERROR });
        }
    }

    public static determineIfLineItemShown({
        totalUsage,
        dimension,
        Offering,
        unitCost,
        freeDimensionOnInvoice,
    }: {
        totalUsage: number;
        dimension: ReadDimensionResponseData;
        Offering: Offering;
        unitCost: number;
        freeDimensionOnInvoice: FreeDimensionOnInvoice;
    }): boolean {
        try {
            const { usageEntitlement, overageAllowed } = dimension;
            if (unitCost === 0 && freeDimensionOnInvoice === FreeDimensionOnInvoice.hide) {
                return false;
            }

            if (Offering instanceof Subscription) {
                // For subscription based offerings
                if (usageEntitlement === undefined && totalUsage > 0) {
                    return true;
                }
                if (usageEntitlement !== undefined) {
                    // If there is entitlement and overage is allowed, show the line item only if there is usage.
                    if (overageAllowed === overageAllowedEnum.true) {
                        if (usageEntitlement === 'inf') {
                            return false;
                        } else {
                            if (totalUsage > 0) {
                                return true;
                            } else {
                                return false;
                            }
                        }
                    } else {
                        // Entitlement without overage, no line item
                        return false;
                    }
                }
            } else {
                // For usage based offerings
                // If there is no usageEntitlement and there is usage, show the line item
                if (usageEntitlement === undefined && totalUsage > 0) {
                    return true;
                }

                if (usageEntitlement !== undefined) {
                    // If there is usageEntitlement and overage is allowed, show the line item.
                    if (overageAllowed === overageAllowedEnum.true) {
                        return true;
                    } else {
                        // Entitlement without overage, no line item
                        return false;
                    }
                } else {
                    // Zero usage, no usageEntitlement means no line item.
                    return false;
                }
            }
        } catch (e) {
            AuditService.publishEvent({ message: 'error in line item', data: [e], topic: AuditScope.ERROR });
            throw e;
        }
    }
}
