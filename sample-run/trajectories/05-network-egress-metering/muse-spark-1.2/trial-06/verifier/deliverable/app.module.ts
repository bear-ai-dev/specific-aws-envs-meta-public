import { OpenTelemetryModule } from 'nestjs-otel';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';

import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrivateAPIOfferingModule, PublicAPIOfferingModule } from './offering/offering.module.js';
import { BillingModule } from './billing/billing.module.js';
import { InfluxModule } from './influx/influx.module.js';
import { PrivateAPIInvoicesModule, PublicAPIInvoicesModule } from './invoice/invoices.module.js';

import { AuthzModule } from './authz/authz.module.js';
import { PrivateAPIServicesModule, PublicAPIServicesModule } from './services/services.module.js';
import { MeasurementModule } from './measurement/measurement.module.js';
import { PrivateAPIDimensionsModule, PublicAPIDimensionsModule } from './dimensions/dimensions.module.js';
import { MargincalcModule } from './margincalc/margincalc.module.js';
import { AgentMeasurementModule } from './agent-measurement/agent-measurement.module.js';
import { UsersModule } from './users/users.module.js';
import { PrivateAPICustomerModule, PublicAPICustomerModule } from './customer/customer.module.js';
import { OnboardingModule } from './onboarding/onboarding.module.js';
import { TransformerModule } from './transformer/transformer.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';

import { EbsVolumeDataGathererModule } from './microservices/ebsVolumeDataGatherer/ebsvolumeDataGatherer.module.js';
import { EbsSnapshotDataGathererModule } from './microservices/ebsSnapshotDataGatherer/ebsSnapshotDataGatherer.module.js';
import { MeasurementConfigModule } from './measurement-config/measurement-config.module.js';
import { PrivateApiUsageModule, UsageModule } from './usage/usage.module.js';
import { ScheduleModule } from '@nestjs/schedule';
import { CostModule } from './cost/cost.module.js';
import { InstanceUptimeModule } from './microservices/instanceUpTime/instanceUptime.module.js';
import { ReservedInstanceModule } from './microservices/reservedInstanceHistory/reservedInstance.module.js';
import { PrivateAPISettingsModule, PublicAPISettingModule } from './setting/settings.module.js';
import { TaxModule } from './tax/tax.module.js';
import { PrivateAPIAnalyticsModule } from './analytics/analytics.module.js';
import { PaymentModule } from './payment/payment.module.js';
import { PrivateInboxModule } from './inbox/inbox.module.js';
import { AuditModule } from './audit/audit.module.js';
import { Ec2InstanceDataGathererModule } from './microservices/ec2InstanceDataGatherer/ec2InstanceDataGatherer.module.js';
import { NetworkOutDataGathererModule } from './microservices/networkOutDataGatherer/networkOutDataGatherer.module.js';
import { AzureModule } from './azure/azure.module.js';
import { PortalModule } from './portal/portal.module.js';
import { KubernetesDeployerModule } from './kubernetes-deployer/kubernetes-deployer.module.js';
import { CreditModule } from './credit/credit.module.js';
import { WebhookModule } from './webhook/webhook.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { EntitlementCheckerModule } from './microservices/entitlementChecker/entitlementChecker.module.js';
import { ContractModule } from './contract/contract.module';
import { InvoiceStatusCheckerModule } from './microservices/invoiceStatusChecker/invoiceStatusChecker.module.js';
import { TokenConsumerModule } from './token-consumer/token-consumer.module';
import { LedgerModule } from './ledger/ledger.module';
import { CustomerGroupModule } from './customergroup/customergroup.module';
const OpenTelemetryModuleConfig = OpenTelemetryModule.forRoot({
    metrics: {
        hostMetrics: true, // Includes Host Metrics
        apiMetrics: {
            enable: true, // Includes api metrics
            defaultAttributes: {
                // You can set default labels for api metrics
                env: process.env.STAGE,
            },
            ignoreUndefinedRoutes: false, //Records metrics for all URLs, even undefined ones
        },
    },
});

@Module({
    imports: [
        ConfigModule.forRoot(),
        PublicAPIOfferingModule,
        PrivateAPIOfferingModule,
        BillingModule,
        InfluxModule,
        PublicAPIInvoicesModule,
        PrivateAPIInvoicesModule,
        AuthzModule,
        PublicAPIServicesModule,
        PrivateAPIServicesModule,
        MeasurementModule,
        PublicAPIDimensionsModule,
        PrivateAPIDimensionsModule,
        MargincalcModule,
        AgentMeasurementModule,
        UsersModule,
        PublicAPICustomerModule,
        PrivateAPICustomerModule,
        OnboardingModule,
        TransformerModule,
        SchedulerModule,
        BullModule.forRoot({
            redis: {
                host: process.env.REDIS_URL ? process.env.REDIS_URL : 'localhost',
                port: process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT) : 6337,
                password: process.env.REDIS_PASSWORD ? process.env.REDIS_PASSWORD : '',
            },
        }),
        EbsVolumeDataGathererModule,
        NetworkOutDataGathererModule,
        Ec2InstanceDataGathererModule,
        EbsSnapshotDataGathererModule,
        EntitlementCheckerModule,
        InvoiceStatusCheckerModule,
        InstanceUptimeModule,
        MeasurementConfigModule,
        ReservedInstanceModule,
        UsageModule,
        CostModule,
        ScheduleModule.forRoot(),
        PrivateAPISettingsModule,
        TaxModule,
        PrivateAPIAnalyticsModule,
        PaymentModule,
        PrivateInboxModule,
        AuditModule,
        PrivateApiUsageModule,
        AzureModule,
        PortalModule,
        KubernetesDeployerModule,
        CreditModule,
        WebhookModule,
        AlertsModule,
        OpenTelemetryModuleConfig,
        ContractModule,
        TokenConsumerModule,
        PublicAPISettingModule,
        LedgerModule,
        CustomerGroupModule,
    ],
    controllers: [AppController],
    providers: [AppService],
})
export class AppModule {}
