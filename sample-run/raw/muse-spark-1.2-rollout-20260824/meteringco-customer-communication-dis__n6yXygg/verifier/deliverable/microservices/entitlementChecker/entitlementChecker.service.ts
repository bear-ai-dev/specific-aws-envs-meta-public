import { Job } from 'bull';
import { SchedulerEntity } from '../../scheduler/entities/scheduler.entity.js';
import { OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { EntitlementCheckerDto } from './dto/entitlementChecker.dto.js';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { CustomerService } from '../../customer/customer.service.js';
import { AlertsService } from '../../alerts/alerts.service.js';
import { AlertState, AlertType } from '../../alerts/dto/create-alert.dto.js';
import { WebhookType } from '../../webhook/dto/create-webhook.dto.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

@Processor('scheduler_queue')
export class EntitlementChecker {
    private static readonly logger = new Logger(EntitlementChecker.name);
    constructor(
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => AlertsService)) readonly alertService: AlertsService,
    ) {}

    @Process('entitlementChecker')
    async evaluateEntitlements({ data: { scheduleParameters, subject, rate } }: Job<SchedulerEntity>) {
        EntitlementChecker.logger.log(`Starting entitlement checker for ${subject} with rate ${rate}`);
        const { businessID, offeringId } = scheduleParameters as EntitlementCheckerDto;
        EntitlementChecker.logger.log(`Evaluating entitlements for customers. OfferingId: ${offeringId}`);
        const { data } = await this.customerService.findAllCustomersWithOfferingId({ businessID, offeringId });

        const entitlementsForAllCustomers = await Promise.all(
            data.map(async (customer) => {
                return this.customerService.evaluateEntitlementsForCustomer(customer, businessID);
            }),
        );
        EntitlementChecker.logger.log(`Entitlements for all customers length: ${entitlementsForAllCustomers?.length}`);
        const entitlementsForAllCustomersFlattened = entitlementsForAllCustomers.flat();
        await Promise.all(
            entitlementsForAllCustomersFlattened.map(async (entitlement) => {
                if (!entitlement?.isEntitled) {
                    EntitlementChecker.logger.log(`Emitting alarm alert for customer ${entitlement.customerId}`);
                    const timestamp = new Date().toISOString();
                    await this.alertService.create({
                        alertId: EntitlementChecker.createAlertId({
                            dimensionId: entitlement.dimensionId,
                            customerId: entitlement.customerId,
                        }),
                        alertState: AlertState.ALARM,
                        businessID,
                        timestamp,
                        alertType: AlertType.ENTITLEMENT_THRESHOLD,
                        webhookParameters: {
                            webhookType: WebhookType.ENTITLEMENT,
                            timestamp,
                            dimensionId: entitlement.dimensionId,
                            entitlementLimit: entitlement.entitlementAmount.toString(),
                            currentUsageTotal: entitlement.usageAmount.toString(),
                            email: entitlement.email,
                            customerId: entitlement.customerId,
                            customerName: entitlement.customerName,
                            eventType: 'usageEntitlementLimitReached',
                        },
                    });
                } else if (entitlement?.percentageUtilized && entitlement?.percentageUtilized > 0.8) {
                    EntitlementChecker.logger.log(`Emitting warning alert for customer ${entitlement.customerId}`);
                    const timestamp = new Date().toISOString();
                    await this.alertService.create({
                        alertId: EntitlementChecker.createAlertId({
                            dimensionId: entitlement.dimensionId,
                            customerId: entitlement.customerId,
                        }),
                        alertState: AlertState.WARNING,
                        businessID,
                        timestamp,
                        alertType: AlertType.ENTITLEMENT_THRESHOLD,
                        webhookParameters: {
                            webhookType: WebhookType.ENTITLEMENT,
                            timestamp,
                            dimensionId: entitlement.dimensionId,
                            entitlementLimit: entitlement.entitlementAmount.toString(),
                            currentUsageTotal: entitlement.usageAmount.toString(),
                            email: entitlement.email,
                            customerId: entitlement.customerId,
                            customerName: entitlement.customerName,
                            eventType: 'usageEntitlementCloseToLimit',
                        },
                    });
                }
            }),
        );
        EntitlementChecker.logger.log(`Finished evaluating entitlements for customers`);
    }
    @OnQueueFailed({ name: 'entitlementChecker' })
    jobFailure(job: Job) {
        AuditService.publishEvent({
            message: 'Failed to determine entitlement limits for customers',
            data: [job],
            topic: AuditScope.ERROR,
        });
    }
    public static createAlertId({ dimensionId, customerId }: { dimensionId: string; customerId: string }) {
        return `${dimensionId}#${customerId}`;
    }
}
