import { Injectable, Logger } from '@nestjs/common';
import { InfluxDB, Point, WriteApi, canRetryHttpCall } from '@influxdata/influxdb-client';
import { DeleteAPI } from '@influxdata/influxdb-client-apis';
import { InfluxQueryDimenisonDTO, InfluxQueryPricingConfigDTO } from './dto/influxQueryDTO.js';
import { OfferingPackageEntity } from '../offering/entities/offeringPackage.entity.js';
import { ServiceEntity } from '../services/entities/service.entity.js';
import { DimensionEntity } from '../dimensions/entities/dimensions.entity.js';
import { MeasurementEntity } from '../measurement/entities/measurement.entity.js';
import { InstanceUptimeEntity } from '../microservices/instanceUpTime/entities/instanceUptime.entity.js';
import { UserEntity } from '../users/entities/user.entity.js';
import { CustomerEntity } from '../customer/entities/customer.entity.js';
import { SchedulerEntity } from '../scheduler/entities/scheduler.entity.js';
import { OfferingInfluxRow } from './entities/offeringInfluxTable.entity.js';
import { ReadDimensionDto } from '../dimensions/dto/read-dimension.dto.js';
import { MeteringCoFilters } from '../measurement-config/entities/measurement-config.entity.js';
import { MeasurementConfigEntity } from '../measurement-config/entities/measurement-config.entity.js';
import { InfluxAggregateUsageEvent } from './influxUsageAggregateEvent.js';
import { EbsVolumeDataGathererEntity } from '../microservices/ebsVolumeDataGatherer/entities/ebsVolumeDataGatherer.entity.js';
import { EBSSnapshot, EBSVolumeProvisionedCapacity } from './entities/ebsVolume.entity.js';
import { UserActiveEnvironment, UserTable } from './entities/userTable.entity.js';
import { CalculatedEbsCostEntity } from '../cost/entities/ebsCost.entity.js';
import { EBSStorageCostEntity } from './entities/ebsStorageCostEntity.js';
import { ReservedInstanceEntity } from '../microservices/reservedInstanceHistory/entities/reservedInstances.entity.js';
import { PodCostEntity } from '../cost/entities/podCost.entity.js';
import { EC2CostInfluxRow } from './entities/ec2CostStorage.entity.js';
import { SettingsEntity } from '../setting/entities/settings.entity.js';
import { ServiceInfluxRow } from './entities/serviceInfluxTable.entity.js';
import { SettingInfluxRow } from './entities/settingsInfluxTable.entity.js';
import { EbsSnapshotDataGathererEntity } from '../microservices/ebsSnapshotDataGatherer/entities/ebsSnapshotDataGatherer.entity.js';
import { Invoice } from '../invoice/entities/invoice.entity.js';
import { InvoiceInfluxRow } from './entities/InvoiceInfluxTable.entity.js';
import { ebsVolumeAggregationEntityRow } from './entities/aggregatedEBSVolume.entity.js';
import { ebsSnapshotAggregationEntityRow } from './entities/aggregatedEBSSnapshot.entity.js';
import { uptimeAggregationInfluxRow } from './entities/aggregatedPodUptime.entity.js';
import { MonthlyCostInfluxRow } from './entities/monthlyCostInfluxRow.js';
import { aggregationInterval, aggregationMethod, roundingEnum } from '../dimensions/dto/create-dimension.dto.js';
import { UsageEntity } from '../usage/entities/usage.entity.js';
import { LabelPodInfluxRow } from './entities/labelPodInfluxRow.entity.js';
import {
    AggregatedUsageResponse,
    MetadataGroupedAggregatedUsageResponse,
    UnAggregatedUsageResponse,
} from '../customer/dto/read-customer.dto.js';
import { AggregationPurpose } from '../customer/dto/AggregationPurpose.js';
import { OrganizationEntity } from '../users/entities/organization.entity.js';
import { OrganizationInfluxRow } from './entities/organizationInfluxRow.entity.js';
import { FreeTrialEntity } from '../setting/entities/freeTrial.entity.js';
import { FreeTrialInfluxRow } from './entities/freeTrialInfluxRow.js';
import { EnvironmentEntity } from '../users/entities/environment.entity.js';
import { CreditEntity } from '../credit/entities/credit.entity.js';
import { Webhook } from '../webhook/entities/webhook.entity.js';
import { WebhookInfluxRow } from './entities/webhook.entity.js';
import { AmountPaidLedgerEntity } from '../payment/entities/AmountPaidLedgerEntity.js';
import { AlertEntity } from '../alerts/entities/alert.entity.js';
import { AlertInfluxRow } from './entities/alertInfluxRow.entity.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { serializeError } from 'serialize-error';
import { ContractEntity } from '../contract/entities/contract.entity.js';
import { ContractInfluxRow } from './entities/contractInfluxRow.js';
import { CustomerInfluxRow } from './entities/customerInfluxRow.js';
import { AggregatedUsageRow, UsageRow } from './entities/usageRow.entity.js';
import { TokenConsumer } from '../token-consumer/entities/token-consumer.entity.js';
import { BaseInfluxTable } from './entities/baseInfluxTable.entity.js';
import { TokenConsumerAsyncProcessor } from '../token-consumer/token-consumer-async-processor.js';

@Injectable()
export class InfluxService {
    private static readonly logger = new Logger(InfluxService.name);
    private static url: string;
    token: string;
    org: string;
    bucket: string;
    dbclient: InfluxDB;
    writeApis: Record<string, WriteApi>;
    constructor() {
        this.token = process.env.INFLUX_TOKEN || '';
        this.org = process.env.INFLUX_ORG || 'meteringco';
        InfluxService.url = process.env.INFLUX_URL || 'https://us-east-1-1.aws.cloud2.influxdata.com';
        InfluxService.logger.log(`Influx URL: ${InfluxService.url}, Influx Org: ${this.org}`);
        this.dbclient = new InfluxDB({ url: InfluxService.url, token: this.token, timeout: 60000 }); // 60 second timeout for requests});
        this.writeApis = {};
    }

    queryAPIInstance() {
        return this.dbclient.getQueryApi(this.org);
    }
    calculateCreditTotal = async ({ customerId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const creditQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CreditEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sum(column: "_value")`;
        const res = await queryApi.collectRows<{ [x: string]: any }>(creditQuery);
        return res;
    };

    calculateAllCreditTotal = async ({ businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const creditQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CreditEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.customerId)
        |> group(columns: ["customerId"], mode:"by")
        |> sum(column: "_value")`;
        const res = await queryApi.collectRows<{ [x: string]: any }>(creditQuery);
        return res;
    };
    static getMeteringCoCustomers = async () => {
        // This function is used to get all customers from meteringco dogfood.
        const meteringcoDogFoodInfluxClient = new InfluxDB({
            url: InfluxService.url,
            token: process.env.METERINGCO_DOGFOOD_INFLUX_SECRET,
            timeout: 60000,
        });
        const dogFoodQueryApi = meteringcoDogFoodInfluxClient.getQueryApi('meteringco');
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const meteringcoCustomerQuery = `from(bucket: "prod-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CustomerEntity._measurement}" or r["_measurement"] == "customer")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["businessID"] == "meteringco-production" or r["businessID"] == "meteringco-sandbox")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;
        const res = await dogFoodQueryApi.collectRows<CustomerInfluxRow>(meteringcoCustomerQuery);
        return res;
    };
    static getMeteringCoOffering = async (
        offeringId: string,
    ): Promise<{ offering?: OfferingPackageEntity; dimensions?: DimensionEntity[] }> => {
        // This function is used to get an offering from meteringco dogfood.
        const meteringcoDogFoodInfluxClient = new InfluxDB({
            url: InfluxService.url,
            token: process.env.METERINGCO_DOGFOOD_INFLUX_SECRET,
            timeout: 60000,
        });
        const dogFoodQueryApi = meteringcoDogFoodInfluxClient.getQueryApi('meteringco');
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const priceDocumentFluxQuery = `from(bucket: "prod-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${OfferingPackageEntity._measurement}")
        |> filter(fn: (r) => exists r.offeringId)
        |> filter(fn: (r) => r["offeringId"] == "${offeringId}")
        |> filter(fn: (r) => r["businessID"] == "meteringco-production" or r["businessID"] == "meteringco-sandbox")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "offeringId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;
        InfluxService.logger.debug(priceDocumentFluxQuery);
        const res = await dogFoodQueryApi.collectRows(priceDocumentFluxQuery);
        if (res?.length > 0) {
            const offering = OfferingPackageEntity.dbModelToEntity(res[0]);
            const dimensionIds = offering.dimensionIds;
            if (dimensionIds.length > 0) {
                const dimensionFluxQuery = `from(bucket: "prod-config")
            |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "${DimensionEntity._measurement}")
            |> filter(fn: (r) => exists r.dimensionId)
            |> filter(fn: (r) => ${InfluxService.dimensionIdsToOrFilter(dimensionIds)})
            |> filter(fn: (r) => r["businessID"] == "meteringco-production" or r["businessID"] == "meteringco-sandbox")
            |> group(columns: ["_measurement"], mode:"by")
            |> sort(columns: ["_time"], desc: true)
            |> unique(column: "dimensionId")
            |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;
                InfluxService.logger.debug(dimensionFluxQuery);
                const res = await dogFoodQueryApi.collectRows(dimensionFluxQuery);
                const dimensions = res.map((dimension) => DimensionEntity.dbModelToEntity(dimension));
                return {
                    offering,
                    dimensions,
                };
            }
            return {
                offering,
                dimensions: [],
            };
        } else {
            return {
                offering: null,
                dimensions: null,
            };
        }
    };
    aggregateMeteringCoToken = async ({
        customerId,
        startDate,
        endDate,
    }: {
        customerId: string;
        startDate: Date;
        endDate: Date;
    }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const aggregateMeteringCoTokenQuery = `from(bucket: "${TokenConsumerAsyncProcessor.tokenAggregateBucket}")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${TokenConsumer._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "meteringco-production" or r["businessID"] == "meteringco-sandbox")
        |> group(columns: ["_measurement"], mode:"by")
        |> sum()
        `;
        const res = await queryApi.collectRows<BaseInfluxTable>(aggregateMeteringCoTokenQuery);
        return res;
    };

    getCurrentAlertState = async ({ businessID, alertId }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const alertQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${AlertEntity._measurement}")
        |> filter(fn: (r) => exists r.alertId)
        |> filter(fn: (r) => r["alertId"] == "${alertId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "alertId")`;
        const res = await queryApi.collectRows<AlertInfluxRow>(alertQuery);
        return res;
    };

    getCreditLedger = async ({ customerId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const creditQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CreditEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        `;
        const res = await queryApi.collectRows<{ [x: string]: any }>(creditQuery);
        return res;
    };
    queryForLedger = async ({
        start,
        end,
        measurement,
        businessID,
        filters,
        orFilters,
        uniqueFilters,
        groupBy,
        existsFilters,
        notExistsFilters,
    }: {
        start: Date;
        end: Date;
        measurement: string;
        businessID: string;
        filters?: Record<string, string | string[]>;
        orFilters?: Record<string, string | string[]>;
        uniqueFilters?: string[];
        groupBy?: string[];
        existsFilters?: string[];
        notExistsFilters?: string[];
    }) => {
        let filterKeys;
        let orFilterKeys;
        if (filters) {
            filterKeys = Object.keys(filters);
        }
        if (orFilters) {
            orFilterKeys = Object.keys(orFilters);
        }

        const queryApi = this.dbclient.getQueryApi(this.org);
        let ledgerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(start).toISOString()}, stop:${new Date(end).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)`;
        if (
            (filterKeys && filterKeys?.length > 0) ||
            (orFilters && orFilterKeys.length > 0) ||
            uniqueFilters ||
            groupBy
        ) {
            let filterString = '';
            let groupByString = '';
            let uniqueFilterString = '';
            let existsFilterString = '';
            let notExistsFilterString = '';
            if (filterKeys?.length) {
                for (const filter of filterKeys) {
                    if (Array.isArray(filters[filter])) {
                        for (const filterValue of filters[filter]) {
                            filterString += `|> filter(fn: (r) => r["${filter}"] == "${filterValue}")`;
                        }
                    } else {
                        filterString += `|> filter(fn: (r) => r["${filter}"] == "${filters[filter]}")`;
                    }
                }
            }
            if (orFilterKeys?.length) {
                filterString += `|> filter(fn: (r) =>`;
                orFilterKeys.forEach((filter, index) => {
                    if (Array.isArray(orFilters[filter])) {
                        const arrayVal = orFilters[filter] as string[];
                        arrayVal.forEach((filterValue, index) => {
                            filterString += `r["${filter}"] == "${filterValue}"`;
                            if (index < orFilters[filter].length - 1) {
                                filterString += ' or ';
                            }
                        });
                    } else {
                        filterString += `r["${filter}"] == "${orFilters[filter]}"`;
                    }
                    if (index < orFilterKeys.length - 1) {
                        filterString += ' or ';
                    } else {
                        filterString += ')';
                    }
                });
            }
            if (groupBy && groupBy?.length > 0) {
                groupByString = `|> group(columns: ${JSON.stringify(groupBy)}, mode:"by")`;
            }
            if (uniqueFilters && uniqueFilters?.length > 0) {
                uniqueFilters.forEach((filterVal) => {
                    uniqueFilterString += `|> unique(column: "${filterVal}")`;
                });
            }
            if (existsFilters && existsFilters?.length > 0) {
                existsFilters.forEach((filterVal) => {
                    existsFilterString += `|> filter(fn: (r) => exists r["${filterVal}"])`;
                });
            }
            if (notExistsFilters && notExistsFilters?.length > 0) {
                notExistsFilters.forEach((filterVal) => {
                    notExistsFilterString += `|> filter(fn: (r) => not exists r["${filterVal}"])`;
                });
            }
            ledgerQuery = `from(bucket: "${process.env.STAGE}-config")
            |> range(start: ${new Date(start).toISOString()}, stop:${new Date(end).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "${measurement}")
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            ${existsFilterString}
            ${filterString}
            ${groupByString}
            ${uniqueFilterString}
            ${notExistsFilterString}
            |> sort(columns: ["_time"], desc: true)`;
        }
        InfluxService.logger.debug(ledgerQuery);
        const res = await queryApi.collectRows(ledgerQuery);
        return res;
    };
    getAmountPaidLedger = async ({ invoiceId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const creditQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${AmountPaidLedgerEntity._measurement}")
        |> filter(fn: (r) => exists r.invoiceId)
        |> filter(fn: (r) => r["invoiceId"] == "${invoiceId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        `;
        const res = await queryApi.collectRows<{ [x: string]: any }>(creditQuery);
        return res;
    };

    sumAmountPaidLedger = async ({ invoiceId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const creditQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${AmountPaidLedgerEntity._measurement}")
        |> filter(fn: (r) => exists r.invoiceId)
        |> filter(fn: (r) => r["invoiceId"] == "${invoiceId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sum(column: "_value")`;
        const res = await queryApi.collectRows<{ [x: string]: any }>(creditQuery);
        return res;
    };

    sumAmountPaidLedgerbyCustomerId = async ({
        customerId,
        businessID,
    }: {
        customerId: string;
        businessID: string;
    }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const creditQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${AmountPaidLedgerEntity._measurement}")
        |> filter(fn: (r) => exists r.invoiceId)
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["invoiceId"], mode:"by")
        |> sum(column: "_value")`;
        const res = await queryApi.collectRows<{ [x: string]: any }>(creditQuery);
        return res;
    };

    sumAmountPaidByInvoiceId = async ({ customerId, businessID, invoiceId }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const creditQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CreditEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["metadata_invoiceId"] == "${invoiceId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sum(column: "_value")`;
        const res = await queryApi.collectRows<{ [x: string]: any }>(creditQuery);
        return res;
    };

    readMeasurementConfigData = async ({ measurementId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const measurementConfigFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${MeasurementConfigEntity._measurement}")
        |> filter(fn: (r) => exists r.measurementId)
        |> filter(fn: (r) => r["measurementId"] == "${measurementId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "measurementId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<{ [x: string]: any }>(measurementConfigFluxQuery);

        return res;
    };

    getLatestWebhook = async ({ webhookId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const webhookFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Webhook._measurement}")
        |> filter(fn: (r) => exists r.webhookId)
        |> filter(fn: (r) => r["webhookId"] == "${webhookId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "webhookId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<WebhookInfluxRow>(webhookFluxQuery);

        return res;
    };
    getAllLatestWebhooks = async ({ businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const webhookFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Webhook._measurement}")
        |> filter(fn: (r) => exists r.webhookId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "webhookId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<WebhookInfluxRow>(webhookFluxQuery);

        return res;
    };
    getAllLatestHooksByType = async ({ businessID, webhookType }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const webhookFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Webhook._measurement}")
        |> filter(fn: (r) => exists r.webhookId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["webhookType"] == "${webhookType}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "webhookId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<WebhookInfluxRow>(webhookFluxQuery);

        return res;
    };
    getLatestFreeTrial = async ({ businessID }): Promise<FreeTrialInfluxRow[]> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const freeTrialQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${FreeTrialEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> first()
        `;

        const res = queryApi.collectRows<FreeTrialInfluxRow>(freeTrialQuery);

        return res;
    };
    readAggregateUsage = async ({ businessID, dimensionId, startTime, endTime }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        const measurementConfigFluxQuery = `from(bucket: "${process.env.STAGE}-aggregate-usage")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => exists r.startTime)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> unique(column: "startTime")
        |> sort(columns: ["startTime"], desc: false)
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<
            ebsVolumeAggregationEntityRow | ebsSnapshotAggregationEntityRow | uptimeAggregationInfluxRow
        >(measurementConfigFluxQuery);

        return res;
    };
    readAllMeaurements = async ({ businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const measurementConfigFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${MeasurementConfigEntity._measurement}")
        |> filter(fn: (r) => exists r.measurementId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "measurementId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<{ [x: string]: any }>(measurementConfigFluxQuery);

        return res;
    };

    aggregateDimensionUsageQuery = async ({
        businessID,
        dimensionId,
        argumentAggregationMethod,
        aggregationInterval,
        startDate,
        endDate,
        customerId,
        usageIncrement,
        rounding,
        aggregationPurpose,
        queryStartTime,
        continious,
        metadataGroups,
    }: {
        businessID: string;
        dimensionId: string;
        argumentAggregationMethod: aggregationMethod;
        aggregationInterval: aggregationInterval;
        startDate: Date;
        endDate: Date;
        customerId?: string;
        usageIncrement: number;
        rounding: roundingEnum;
        aggregationPurpose: AggregationPurpose;
        queryStartTime: Date;
        continious?: boolean;
        metadataGroups?: Record<string, string>;
    }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        let dimensionAggregationFluxQuery;
        const queryEndTime = new Date(endDate.getTime() + 1);
        if (aggregationPurpose === AggregationPurpose.METERING) {
            if (argumentAggregationMethod === aggregationMethod.last) {
                dimensionAggregationFluxQuery = `     
            import "math"
            from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${startDate.toISOString()}, stop:${endDate.toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
            |> filter(fn: (r) => r["customerId"] == "${customerId}")
            |> filter(fn: (r) => r["_measurement"] == "${UsageEntity._measurement}")
            ${metadataGroups ? this.customGroupBy(metadataGroups) : '|> group(columns: ["_measurement"], mode:"by")'}
            |> sort(columns: ["_time"], desc: false)
            |> last()
            |> aggregateWindow(every: ${this.aggregationIntervalToInfluxQueryLine(
                aggregationInterval,
            )}, fn: last, createEmpty: true)
            ${continious ? '|> fill(usePrevious: true)' : ''}
            ${continious ? this.queryRange(queryStartTime, queryEndTime) : ''}`;
            } else {
                dimensionAggregationFluxQuery = `
            import "math"
            from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${startDate.toISOString()}, stop:${endDate.toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
            |> filter(fn: (r) => r["customerId"] == "${customerId}")
            |> filter(fn: (r) => r["_measurement"] == "${UsageEntity._measurement}")
            ${metadataGroups ? this.customGroupBy(metadataGroups) : '|> group(columns: ["_measurement"], mode:"by")'}
            |> aggregateWindow(every: ${this.aggregationIntervalToInfluxQueryLine(
                aggregationInterval,
            )}, fn: ${this.aggregationMethodToQueryLine(argumentAggregationMethod)}, createEmpty: true)
            ${continious ? '|> fill(usePrevious: true)' : ''}
            ${continious ? this.queryRange(queryStartTime, queryEndTime) : ''}
            |> sort(columns: ["_time"], desc: false)
            `;
            }
        } else {
            if (argumentAggregationMethod === aggregationMethod.last) {
                dimensionAggregationFluxQuery = `
                import "math"
                from(bucket: "${process.env.STAGE}-usage-data")
                |> range(start: ${startDate.toISOString()}, stop:${endDate.toISOString()})
                |> filter(fn: (r) => r["businessID"] == "${businessID}")
                |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
                |> filter(fn: (r) => r["customerId"] == "${customerId}")
                |> filter(fn: (r) => r["_measurement"] == "${UsageEntity._measurement}")
                ${
                    metadataGroups
                        ? this.customGroupBy(metadataGroups)
                        : '|> group(columns: ["_measurement"], mode:"by")'
                }
                |> sort(columns: ["_time"], desc: false)
                |> last()
                |> aggregateWindow(every: ${this.aggregationIntervalToInfluxQueryLine(
                    aggregationInterval,
                )}, fn: last, createEmpty: true)
                ${continious ? '|> fill(usePrevious: true)' : ''}
                |> map(fn: (r) => ({r with _value: float(v: r._value) / float(v: ${usageIncrement})}))
                ${this.roundingInfluxMethod(rounding)}
                |> map(fn: (r) => ({r with _value: float(v: r._value) * float(v: ${usageIncrement})}))
                ${continious ? this.queryRange(queryStartTime, queryEndTime) : ''}
                `;
            } else {
                dimensionAggregationFluxQuery = `
            import "math"
            from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${startDate.toISOString()}, stop:${endDate.toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
            |> filter(fn: (r) => r["customerId"] == "${customerId}")
            |> filter(fn: (r) => r["_measurement"] == "${UsageEntity._measurement}")
            ${metadataGroups ? this.customGroupBy(metadataGroups) : '|> group(columns: ["_measurement"], mode:"by")'}
            |> aggregateWindow(every: ${this.aggregationIntervalToInfluxQueryLine(
                aggregationInterval,
            )}, fn: ${this.aggregationMethodToQueryLine(argumentAggregationMethod)}, createEmpty: true)
            ${continious ? '|> fill(usePrevious: true)' : ''}
            |> map(fn: (r) => ({r with _value: float(v: r._value) / float(v: ${usageIncrement})}))
            ${this.roundingInfluxMethod(rounding)}
            |> map(fn: (r) => ({r with _value: float(v: r._value) * float(v: ${usageIncrement})}))
            ${continious ? this.queryRange(queryStartTime, queryEndTime) : ''}
            |> sort(columns: ["_time"], desc: false)
            `;
            }
        }
        InfluxService.logger.debug(dimensionAggregationFluxQuery);
        const res = queryApi.collectRows<AggregatedUsageRow>(dimensionAggregationFluxQuery);

        return res;
    };

    roundingInfluxMethod = (rounding: roundingEnum) => {
        switch (rounding) {
            case roundingEnum.round:
                return `|> map(fn: (r) => ({r with _value: math.round(x: r._value)}))`;
            case roundingEnum.floor:
                return `|> map(fn: (r) => ({r with _value: math.floor(x: r._value)}))`;
            case roundingEnum.ceiling:
                return `|> map(fn: (r) => ({r with _value: math.ceil(x: r._value)}))`;
            default:
                return 'round';
        }
    };
    customGroupBy = (metadataGroups: Record<string, string>) => {
        const groupArray = [];
        const groupStartString = `|> group(columns:`;
        const groupEndString = `, mode:"by")`;
        Object.keys(metadataGroups).forEach((key) => {
            groupArray.push(`"metadata_${key}"`);
        });
        return groupStartString + `["_measurement", ${groupArray.join(', ')}]` + groupEndString;
    };
    queryRange = (queryStart: Date, queryEnd: Date) => {
        return `|> range(start: ${queryStart.toISOString()}, stop:${queryEnd.toISOString()})`;
    };
    dimensionUsageNoAggregation = async ({
        businessID,
        dimensionId,
        startDate,
        endDate,
        customerId,
    }: {
        businessID: string;
        dimensionId: string;
        startDate: Date;
        endDate: Date;
        customerId?: string;
    }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const dimensionAggregationFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${startDate.toISOString()}, stop:${endDate.toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["_measurement"] == "${UsageEntity._measurement}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: false)
        `;
        const res = queryApi.collectRows<UsageRow>(dimensionAggregationFluxQuery);

        return res;
    };
    private aggregationMethodToQueryLine(aggMethod: aggregationMethod) {
        switch (aggMethod) {
            case 'sum':
                return 'sum';
            case 'average':
                return 'mean';
            case 'min':
                return 'min';
            case 'max':
                return 'max';
            case 'count':
                return 'count';
        }
    }
    private aggregationIntervalToInfluxQueryLine(aggregationInterval: aggregationInterval) {
        switch (aggregationInterval) {
            case 'hour':
                return '1h';
            case 'day':
                return '1d';
            case 'month':
                return '1mo';
        }
    }
    readAllEBSVolumesForAService = async ({ serviceId, businessID, applicationId }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        let ebsVolumeFluxQuery;
        if (applicationId) {
            ebsVolumeFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${EbsVolumeDataGathererEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["tag_meteringcoServiceId"] == "${serviceId}" or r["tag_meteringcoApplicationId"] == "${applicationId}" )
        |> filter(fn: (r) => exists r.state)
        |> filter(fn: (r) => r["state"] == "in-use" or r["state"] == "available")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column:"volumeID")`;
        } else {
            ebsVolumeFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${EbsVolumeDataGathererEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["tag_meteringcoServiceId"] == "${serviceId}")
        |> filter(fn: (r) => exists r.state)
        |> filter(fn: (r) => r["state"] == "in-use")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column:"volumeID")`;
        }

        const res = queryApi.collectRows<EBSVolumeProvisionedCapacity>(ebsVolumeFluxQuery);

        return res;
    };

    getMeteringCoTaggedMaxEbsVolumeMeasurementInTimeRange = async ({ businessID, startTime, endTime }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const measurementConfigFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${EbsVolumeDataGathererEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.state)
        |> filter(fn: (r) => r["state"] == "in-use" or r["state"] == "available")
        |> filter(fn: (r) => exists r.tag_meteringcoServiceId or exists r.tag_meteringcoApplicationId)
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column:"volumeID")`;

        const res = queryApi.collectRows<EBSVolumeProvisionedCapacity>(measurementConfigFluxQuery);

        return res;
    };
    getMeteringCoTaggedMaxEbsSnapshotMeasurementInTimeRange = async ({ businessID, startTime, endTime }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const snapshotQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${EbsSnapshotDataGathererEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.tag_meteringcoServiceId or exists r.tag_meteringcoApplicationId)
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column:"snapshotId")`;

        const res = queryApi.collectRows<EBSSnapshot>(snapshotQuery);

        return res;
    };
    readAverageEBSCost({ businessID }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const averageEBSCostFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CalculatedEbsCostEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.volumeType)
        |> group(columns: ["volumeType", "businessID", "iops", "storageSize", "throughput"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> mean()`;

        const res = queryApi.collectRows<EBSStorageCostEntity>(averageEBSCostFluxQuery);

        return res;
    }

    readAverageEC2Cost({ businessID }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const averageEC2CostFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${PodCostEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["cpu", "ram"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> mean()`;

        const res = queryApi.collectRows<EC2CostInfluxRow>(averageEC2CostFluxQuery);

        return res;
    }
    readMeasurementConfigDataByDimensionId = async ({ dimensionId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const measurementConfigFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${MeasurementConfigEntity._measurement}")
        |> filter(fn: (r) => exists r.measurementId)
        |> filter(fn: (r) => r["dimensionId_${dimensionId}"] == "${dimensionId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "measurementId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<{ [x: string]: any }>(measurementConfigFluxQuery);

        return res;
    };
    readUserData = async (subject, environment) => {
        const queryApi = this.dbclient.getQueryApi(this.org);

        // Query range for all time. needed for tsdb query cant give unbounded range
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${UserEntity._measurementActiveEnvironment}")
        |> filter(fn: (r) => r["subject"] == "${subject}")
        |> filter(fn: (r) => r["environment"] == "${environment}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "subject")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;
        const res = queryApi.collectRows<UserTable>(fluxQuery);
        return res;
    };
    readEnvironmentForBusiness = async (businessID) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        // Query range for all time. needed for tsdb query cant give unbounded range
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${UserEntity._measurementActiveEnvironment}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "businessID")`;

        const res = queryApi.collectRows<UserTable>(fluxQuery);
        return res;
    };
    readAllUserData = async () => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        // Query range for all time. needed for tsdb query cant give unbounded range
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${UserEntity._measurementActiveEnvironment}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "subject")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<UserTable>(fluxQuery);
        return res;
    };
    readAllUsersForBusiness = async (businessID) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        // Query range for all time. needed for tsdb query cant give unbounded range
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${UserEntity._measurementActiveEnvironment}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "subject")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<UserTable>(fluxQuery);
        return res;
    };
    readCurrentUserEnv = async (subject) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        // Query range for all time. needed for tsdb query cant give unbounded range
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${EnvironmentEntity._measurement}")
        |> filter(fn: (r) => r["subject"] == "${subject}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> top(n: 1, columns:["_time"])`;
        const res = queryApi.collectRows<UserActiveEnvironment>(fluxQuery);

        return res;
    };

    readAllEnvironmentsForUser = async (subject) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        // Query range for all time. needed for tsdb query cant give unbounded range
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${UserEntity._measurementActiveEnvironment}")
        |> filter(fn: (r) => r["subject"] == "${subject}")
        |> group(columns: ["environment"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> top(n: 1, columns:["_time"])`;
        InfluxService.logger.debug(`readAllEnvironmentsForUser: ${fluxQuery}`);
        const res = queryApi.collectRows<UserTable>(fluxQuery);
        return res;
    };

    readAllBusinesses = async () => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        // Query range for all time. needed for tsdb query cant give unbounded range
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${UserEntity._measurement}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "businessID")`;

        const res = queryApi.collectRows<UserTable>(fluxQuery);
        return res;
    };
    dropDimensionConfig = async (bucket: string, org: string = this.org, businessID: string, dimensionId: string) => {
        const deleteClient = new DeleteAPI(this.dbclient);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        InfluxService.logger.warn('Deleting Dimension From DB', {
            businessID,
            dimensionId,
            org,
            bucket,
        });
        const response = deleteClient.postDelete({
            bucket,
            org,
            body: {
                start: startDate.toISOString(),
                stop: endDate.toISOString(),
                predicate: `_measurement="${DimensionEntity._measurement}" AND businessID="${businessID}" AND dimensionId="${dimensionId}"`,
            },
        });
        return response;
    };
    queryDimension = async ({ _measurement, serviceId, businessID, startDate, endDate }: InfluxQueryDimenisonDTO) => {
        const queryApi = this.dbclient.getQueryApi(this.org);

        const fluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${_measurement}")
        |> filter(fn: (r) => r["meteringco-id"] == "${serviceId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")`;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    };
    getReservedInstances = async ({ businessID }: { businessID: string }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const reservedInstanceQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${ReservedInstanceEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "reservedInstancesId")`;
        const res = queryApi.collectRows(reservedInstanceQuery);

        return res;
    };

    getAggregateUsageForDimension = async (
        aggregateEvent: InfluxAggregateUsageEvent,
    ): Promise<AggregatedUsageResponse[] | UnAggregatedUsageResponse[] | MetadataGroupedAggregatedUsageResponse[]> => {
        const res = await InfluxAggregateUsageEvent.buildAggregationQueries(aggregateEvent);
        if (res && res.length > 0) {
            return res.reduce((acc, queryRes) => {
                acc;
                if (Array.isArray(queryRes)) {
                    queryRes.forEach((row) => {
                        //eslint-disable-next-line
                        // @ts-ignore
                        acc.push(row);
                    });
                    return acc;
                } else {
                    //eslint-disable-next-line
                    // @ts-ignore
                    acc.push(queryRes);
                    return acc;
                }
            }, []) as
                | AggregatedUsageResponse[]
                | UnAggregatedUsageResponse[]
                | MetadataGroupedAggregatedUsageResponse[];
        } else {
            return [];
        }
    };
    getLatestOfferingConfig = async ({
        businessID,
        offeringId,
    }: InfluxQueryPricingConfigDTO): Promise<Array<OfferingInfluxRow | Record<string, any>>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const priceDocumentFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${OfferingPackageEntity._measurement}")
        |> filter(fn: (r) => exists r.offeringId)
        |> filter(fn: (r) => r["offeringId"] == "${offeringId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "offeringId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;
        const res = queryApi.collectRows<OfferingInfluxRow>(priceDocumentFluxQuery);

        return res;
    };
    getAllOfferingConfigs = async ({ businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const priceDocumentFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${OfferingPackageEntity._measurement}")
        |> filter(fn: (r) => exists r.offeringId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["offeringId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "offeringId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;
        const res = queryApi.collectRows<OfferingInfluxRow>(priceDocumentFluxQuery);

        return res;
    };

    getAllOfferingIdsByDimensionId = async ({ dimensionId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const offeringFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${OfferingPackageEntity._measurement}")
        |> filter(fn: (r) => exists r.offeringId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement", "offeringId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "offeringId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        |> filter(fn: (r) => r["dimensionId_${dimensionId}"] == "${dimensionId}")`;
        InfluxService.logger.debug(offeringFluxQuery);
        const res = queryApi.collectRows<OfferingInfluxRow>(offeringFluxQuery);

        return res;
    };
    getAllServicesByOfferingId = async ({ offeringId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const serviceFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${ServiceEntity._measurement}")
        |> filter(fn: (r) => exists r.offeringId)
        |> filter(fn: (r) => r["offeringId"] == "${offeringId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "serviceId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows<ServiceInfluxRow>(serviceFluxQuery);

        return res;
    };
    getAllCustomersByOfferingId = async ({ offeringId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const serviceFluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CustomerEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.customerId)
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        |> filter(fn: (r) => r["offeringId"] == "${offeringId}")`;

        const res = queryApi.collectRows<CustomerInfluxRow>(serviceFluxQuery);

        return res;
    };
    getLatestEC2InstanceState = async ({ instanceID, businessID }): Promise<Array<{ _value?: string }>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const instanUptimeFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${InstanceUptimeEntity._measurement}")
        |> filter(fn: (r) => r["instanceID"] == "${instanceID}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "instanceID")`;
        const results = queryApi.collectRows(instanUptimeFluxQuery);
        return results;
    };
    getEC2InstanceData = async ({ privateDNS, businessID }): Promise<Array<{ _value?: string }>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const instanceUptimeFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${InstanceUptimeEntity._measurement}")
        |> filter(fn: (r) => r["privateDNS"] == "${privateDNS}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "privateDNS")`;
        const results = queryApi.collectRows(instanceUptimeFluxQuery);
        return results;
    };

    getLatestCustomers({ businessID }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CustomerEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.customerId)
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_value"], desc: true)
        `;
        const results = queryApi.collectRows<CustomerInfluxRow>(customerQuery);
        return results;
    }

    getLatestOrg = async ({ businessID }): Promise<Array<OrganizationInfluxRow>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const orgQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${OrganizationEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.orgId)
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> top(n: 1)
        `;
        const results = queryApi.collectRows<OrganizationInfluxRow>(orgQuery);
        return results;
    };
    findApplicationId = ({ applicationId, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${ServiceEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["applicationId"] == "${applicationId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "serviceId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        `;
        const results = queryApi.collectRows<ServiceInfluxRow>(customerQuery);
        return results;
    };

    getAllScheduledActions({ businessID }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${SchedulerEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "schedulerID")
        |> filter(fn: (r) => r._value != "inactive")
        `;
        const results = queryApi.collectRows(customerQuery);
        return results;
    }
    getAScheduledAction({ businessID, schedulerID }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${SchedulerEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["schedulerID"] == "${schedulerID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "schedulerID")
        |> filter(fn: (r) => r._value != "inactive")
        `;
        const results = queryApi.collectRows(customerQuery);
        return results;
    }
    getCurrentCountOfCustomers({ businessIDs }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CustomerEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => ${InfluxService.businessIDsToOrFilter(businessIDs)})
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        |> group()
        |> count()
        `;
        const results = queryApi.collectRows(customerQuery);
        return results;
    }
    static businessIDsToOrFilter(businessIDs: string[]): string {
        return businessIDs.reduce((acc, businessID, index) => {
            // Determine if its the first element
            // If it is, we don't want to add an OR
            // If it isn't, we want to add an OR
            const or = index === 0 ? '' : 'or';
            return `${acc} ${or} r["businessID"] == "${businessID}"`;
        }, '');
    }
    static dimensionIdsToOrFilter(dimensionIds: string[]): string {
        return dimensionIds.reduce((acc, dimensionId, index) => {
            // Determine if its the first element
            // If it is, we don't want to add an OR
            // If it isn't, we want to add an OR
            const or = index === 0 ? '' : 'or';
            return `${acc} ${or} r["dimensionId"] == "${dimensionId}"`;
        }, '');
    }
    getCurrentCountOfOfferings({ businessIDs }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');

        const endDate = new Date();
        const offeringQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()}) 
        |> filter(fn: (r) => r["_measurement"] == "${OfferingPackageEntity._measurement}")
        |> filter(fn: (r) => exists r.offeringId)
        |> filter(fn: (r) => ${InfluxService.businessIDsToOrFilter(businessIDs)})
        |> group(columns: ["_measurement", "offeringId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "offeringId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        |> group()
        |> count()
        `;
        const results = queryApi.collectRows(offeringQuery);
        return results;
    }
    getLatestCustomer({ businessID, customerId }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        InfluxService.logger.log(`getLatestCustomer: ${businessID} ${customerId}`);
        InfluxService.logger.log(`Org: ${this.org}`);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CustomerEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        `;
        const results = queryApi.collectRows<CustomerInfluxRow>(customerQuery);
        return results;
    }

    getLatestCustomerContract = async ({ businessID, customerId }): Promise<ContractInfluxRow[]> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        InfluxService.logger.log(`getLatestCustomer: ${businessID} ${customerId}`);
        InfluxService.logger.log(`Org: ${this.org}`);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerContractQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${ContractEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        `;
        const results = queryApi.collectRows<ContractInfluxRow>(customerContractQuery);
        return results;
    };
    getCustomerContracts = async ({ businessID }): Promise<ContractInfluxRow[]> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        InfluxService.logger.log(`getCustomerContracts: ${businessID} `);
        InfluxService.logger.log(`Org: ${this.org}`);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerContractQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${ContractEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["customerId", "offeringId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> unique(column: "offeringId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        `;
        const results = queryApi.collectRows<ContractInfluxRow>(customerContractQuery);
        return results;
    };
    getCustomerContractsUsingOfferingId = async ({ businessID, offeringId }): Promise<ContractInfluxRow[]> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        InfluxService.logger.log(`getCustomerContracts: ${businessID} `);
        InfluxService.logger.log(`Org: ${this.org}`);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerContractQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${ContractEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["offeringId"] == "${offeringId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "customerId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        `;
        const results = queryApi.collectRows<ContractInfluxRow>(customerContractQuery);
        return results;
    };
    getCustomerLedger({ businessID, customerId }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        InfluxService.logger.log(`getLatestCustomer: ${businessID} ${customerId}`);
        InfluxService.logger.log(`Org: ${this.org}`);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const customerQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${CustomerEntity._measurement}")
        |> filter(fn: (r) => exists r.customerId)
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        `;
        const results = queryApi.collectRows(customerQuery);
        return results;
    }

    getAllOfferingIds = async ({ businessID }): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${OfferingPackageEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.offeringId)
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "offeringId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    };
    getAllDimensionIds = async ({ businessID }): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${DimensionEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.dimensionId)
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "dimensionId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    };
    getAllDimensions = async ({ businessID }): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${DimensionEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.dimensionId)
        |> group(columns: ["dimensionId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "dimensionId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    };
    getAllDimensionIdsWithMeasurementId = async ({ businessID, measurementId }): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${DimensionEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.dimensionId)
        |> filter(fn: (r) => r["measurementId"] == "${measurementId}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "dimensionId")
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")`;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    };

    loadPoints = async (bucket: string, org: string = this.org, data: Array<Point>, flush = true) => {
        try {
            if (!this.writeApis[bucket]) {
                this.writeApis[bucket] = this.dbclient.getWriteApi(org, bucket);
            }
            this.writeApis[bucket].writePoints(data);
            if (flush) {
                await this.writeApis[bucket].flush();
            }
        } catch (e) {
            if (canRetryHttpCall(e)) {
                InfluxService.logger.warn(`Failed to initally load points into DB. Retrying`, serializeError(e));
                try {
                    await this.writeApis[bucket].flush();
                } catch (e) {
                    AuditService.publishEvent({
                        topic: AuditScope.DATABASE_ERROR,
                        data: [serializeError(e), canRetryHttpCall(e)],
                        message: `Failed to load points into DB.  After retrying once, Can Retry: ${canRetryHttpCall(
                            e,
                        )}`,
                    });
                }
            } else {
                AuditService.publishEvent({
                    topic: AuditScope.DATABASE_ERROR,
                    data: [serializeError(e), canRetryHttpCall(e)],
                    message: `Failed to load points into DB. Can Retry: ${canRetryHttpCall(e)}`,
                });
            }
        }
    };
    getPoint = (measurement: string): Point => {
        return new Point(measurement);
    };

    dropPricingConfig = async (bucket: string, org: string = this.org, businessID: string, offeringId: string) => {
        const deleteClient = new DeleteAPI(this.dbclient);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        InfluxService.logger.warn('Deleting Price Document from DB', { businessID, offeringId, org, bucket });
        const response = deleteClient.postDelete({
            bucket,
            org,
            body: {
                start: startDate.toISOString(),
                stop: endDate.toISOString(),
                predicate: `_measurement="${OfferingPackageEntity._measurement}" AND businessID="${businessID}" AND offeringId="${offeringId}"`,
            },
        });
        return response;
    };

    getSingleService(measurement, businessID, serviceId) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["serviceId"] == "${serviceId}")
        |> group(columns: ["serviceId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        ${InfluxService.fillUniqueColumn('serviceId')}`;
        const res = queryApi.collectRows(fluxQuery);
        return res;
    }

    getAllServicesWithofferingId(measurement, businessID, offeringId) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${measurement}")
        |> filter(fn: (r) => r["offeringId"] == "${offeringId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["serviceId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        ${InfluxService.fillUniqueColumn('serviceId')}
        
        `;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    }

    getAllServicesWithCustomerId(measurement, businessID, customerId) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${measurement}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["serviceId"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        ${InfluxService.fillUniqueColumn('serviceId')}
        |> filter(fn: (r) => not exists r.softDelete or r.softDelete != "deleted")
        `;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    }
    getAllElementsFromTableForBusiness(measurement, businessID, unqiueColumn = '') {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        let fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")`;
        if (unqiueColumn) {
            // Group and sort by the unique column ID, IE: get the last change in the ledger for the column
            fluxQuery =
                fluxQuery +
                `|> group(columns: ["${unqiueColumn}"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        ${InfluxService.fillUniqueColumn(unqiueColumn)}`;
        }

        const res = queryApi.collectRows(fluxQuery);
        return res;
    }

    static fillUniqueColumn(columnName) {
        return `|> filter(fn: (r) => exists r.${columnName})
                |> unique(column: "${columnName}" )`;
    }
    dropService(bucket: string, org: string = this.org, businessID: string, serviceId: string) {
        const deleteClient = new DeleteAPI(this.dbclient);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        InfluxService.logger.warn('Deleting Service from DB', { businessID, serviceId, org, bucket });
        const response = deleteClient.postDelete({
            bucket,
            org,
            body: {
                start: startDate.toISOString(),
                stop: endDate.toISOString(),
                predicate: `_measurement="${ServiceEntity._measurement}" AND businessID="${businessID}" AND serviceId="${serviceId}"`,
            },
        });
        return response;
    }
    dropMeasurementsBetweenDateRanges(
        bucket: string,
        org: string = this.org,
        { startTime, endTime, infrastructureType, businessID },
    ) {
        // Warning this method deletes all measurements for all services between the date range specified.
        const deleteClient = new DeleteAPI(this.dbclient);
        const startDate = new Date(startTime);
        const endDate = new Date(endTime);
        InfluxService.logger.warn('Deleting Measurements from DB', {
            businessID,
            org,
            bucket,
            startTime,
            endTime,
            infrastructureType,
        });
        const response = deleteClient.postDelete({
            bucket,
            org,
            body: {
                start: startDate.toISOString(),
                stop: endDate.toISOString(),
                predicate: `_measurement="${MeasurementEntity._measurement}" AND businessID="${businessID}"  AND _field="${infrastructureType}"`,
            },
        });
        return response;
    }
    getMeasurementsBetweenDateRange({ startTime, endTime, infrastructureType, businessID }) {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${MeasurementEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["_field"] == "${infrastructureType}")`;
        const res = queryApi.collectRows(fluxQuery);
        return res;
    }
    getUsageForKubernetesPods = async ({ startTime, endTime, businessID, filters = [] }): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        let fluxQuery;
        if (filters?.length) {
            fluxQuery = `labeldata = from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => exists r.pod)
            |> filter(fn: (r)=> r["__name__"] == "kube_pod_labels")
            ${InfluxService.metadataFilterBuilder(filters)}
            |> group(columns: ["pod"], mode:"by")
            |> unique(column:"__name__")
            |> yield(name: "labeldata")
            |> keep(columns: ["pod"])
    
    
            usagedata = from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r)=> r["__name__"] != "kube_pod_labels")
            |> filter(fn: (r) => exists r.pod)
            |> sort(columns: ["_time"], desc: true)
            |> group(columns: ["pod"], mode:"by")
            |> unique(column:"__name__")
    
            JoinedPods = join(
                tables: {labels:labeldata, usage:usagedata},
                on: ["pod"],
            )
            |> yield( name: "podUsage")

            startMetricTime = from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => exists r.pod)
            |> sort(columns: ["_time"], desc: false)
            |> group(columns: ["pod"], mode:"by")
            |> first()
            
            endMetricTime = from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => exists r.pod)
            |> sort(columns: ["_time"], desc: false)
            |> group(columns: ["pod"], mode:"by")
            |> last()
            |> keep(columns: ["_time", "pod"])
    
            JoinedMetricPods = join(
                tables: {endMetricTime:endMetricTime, startMetricTime:startMetricTime},
                on: ["pod"],
            )
            join(
                tables: {labelsAndMetrics:JoinedPods, metricStartAndEndTime:JoinedMetricPods},
                on: ["pod"],
            )
            |> keep(columns: ["_time_endMetricTime", "_time_startMetricTime", "pod"])
            |> unique(column:"pod")
            `;
        } else {
            fluxQuery = ` 
        podData = from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.pod)
        |> sort(columns: ["_time"], desc: true)
        |> group(columns: ["pod"], mode:"by")
        |> unique(column:"__name__")
        |> yield( name: "podUsage")

        startMetricTime = from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.pod)
        |> group(columns: ["pod"], mode:"by")
        |> sort(columns: ["_time"], desc: false)
        |> first()
        
        endMetricTime = from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.pod)
        |> group(columns: ["pod"], mode:"by")
        |> sort(columns: ["_time"], desc: false)
        |> last()
        |> keep(columns: ["_time", "pod"])

        JoinedMetricPods = join(
            tables: {endMetricTime:endMetricTime, startMetricTime:startMetricTime},
            on: ["pod"],
        )

        join(
            tables: {labelsAndMetrics:podData, metricStartAndEndTime:JoinedMetricPods},
            on: ["pod"],
        )
        |> keep(columns: ["_time_endMetricTime", "_time_startMetricTime", "pod"])
        |> unique(column:"pod")
        `;
        }
        const res = queryApi.collectRows(fluxQuery);
        return res;
    };

    getAllStartStopTimesForPodsInBusiness = async ({ businessID, startTime, endTime }): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        // I couldn't figure out how to join node and Pod data in Influx, so it needs to be taken care of outside of Influx
        // Additionally, I was too frustrated to figure out how to rewrite the query to not need the first node lookup so I kept it, thats why there is a nodeData2.
        // If you want to fix this please go ahead.
        const fluxQuery = `
        import "join"
        
        

        firstTime = from(bucket: "${process.env.STAGE}-usage-data")
                |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
                |> filter(fn: (r) => r["businessID"] == "${businessID}")
                |> filter(fn: (r) => r["_measurement"] == "meteringco_kube_pod_container_status_running")
                |> filter(fn: (r) => exists r.pod)
                |> keep(columns:["_measurement", "_field", "_start", "_stop", "_time", "_value", "pod", "uid"])
                |> group(columns: ["pod"], mode:"by")
                |> first()
        lastTime = from(bucket: "${process.env.STAGE}-usage-data")
                |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
                |> filter(fn: (r) => r["businessID"] == "${businessID}")
                |> filter(fn: (r) => r["_measurement"] == "meteringco_kube_pod_container_status_running")
                |> filter(fn: (r) => exists r.pod)
                |> keep(columns:["_measurement", "_field", "_start", "_stop", "_time", "_value", "pod", "uid"])
                |> group(columns: ["pod"], mode:"by")
                |> last() 
        
                firstAndLast = union(tables: [firstTime, lastTime])
                |> group(columns: ["pod"], mode:"by")            
                     
                nodeData = from(bucket: "${process.env.STAGE}-usage-data")
                |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
                |> filter(fn: (r) => r["businessID"] == "${businessID}")
                |> filter(fn: (r) => exists r.pod)
                |> filter(fn: (r) => exists r.node)
                |> group(columns: ["pod"], mode:"by")
                |> unique(column: "pod")
                |> keep(columns: ["node", "pod"])
                |> group(columns: ["pod"], mode:"by")
        
                startStopDeleteodeInfo = join.tables(
                    method: "left",
                    left: firstAndLast, 
                    right:   nodeData,
                    on: (l, r) => l.pod == r.pod,
                    as: (l, r) => ({ l with node: r.node}), 	
                )
                |> group(columns: ["pod"], mode:"by")
                
                
                
                podLabels = from(bucket: "${process.env.STAGE}-usage-data")
                |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
                |> filter(fn: (r) => r["businessID"] == "${businessID}")
                    |> filter(fn: (r) => r["_measurement"] == "meteringco_kube_pod_labels")
                    |> filter(fn: (r) => exists r.label_meteringco_customer_id)
                    |> filter(fn: (r) => exists r.pod)
                    |> group(columns: ["pod"], mode:"by")
                    |> unique(column:"pod")
                  
                    union(tables: [podLabels, startStopDeleteodeInfo])
                    |> group(columns: ["pod"], mode:"by") 
                    |> sort(columns:["_time"], desc: true)
                
        `;
        const res = queryApi.collectRows(fluxQuery);

        return res;
    };
    getAllPodsForBusiness = async ({ startTime, endTime, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.pod)
        |> keep(columns: ["_time", "pod"])
        |> group(columns: ["pod"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "pod")`;
        const res = queryApi.collectRows(fluxQuery);
        return res;
    };

    getNodeForPod = async ({ pod, startTime, endTime, businessID }): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `
        node = from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => r["_measurement"] == "InstanceMetaData")
        |> group(columns: ["privateDNS"], mode:"by")
        |> sort()
        |> first()



        pod = from(bucket: "${process.env.STAGE}-usage-data")
            |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => r["_measurement"] == "meteringco_kube_pod_info")
            |> filter(fn: (r) => r["pod"] == "${pod}")
            |> group(columns: ["pod"], mode:"by")
            |> sort()
            |> first()

        union(tables: [pod, node])
        `;
        const res = (await queryApi.collectRows(fluxQuery)) as Array<any>;

        // filtering based on privateDNS outside of Influx
        const podData = res.find((item) => {
            //eslint-disable-next-line
            // @ts-ignore
            return item?._measurement === 'meteringco_kube_pod_info';
        });
        let privateDns = '';
        if (podData) {
            //eslint-disable-next-line
            // @ts-ignore
            privateDns = podData?.node;
        } else {
            return [];
        }
        const results = res.reduce((acc: Array<any>, item: Record<string, string>): Array<any> => {
            //eslint-disable-next-line
            // @ts-ignore
            if (item?._measurement === 'InstanceMetaData' && item[privateDNS] === privateDns) {
                acc.push(item);
            }
            return acc;
        }, []);
        return results;
    };

    getPodsInReadyState = async ({
        startTime,
        endTime,
        businessID,
    }: {
        startTime: Date;
        endTime: Date;
        businessID: string;
    }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `import "join"

        ready = from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
                      |> filter(fn: (r) => r["_measurement"] == "meteringco_kube_pod_container_status_running")
                      |> filter(fn: (r) => exists r.pod)
                      |> keep(columns:["_measurement", "_field", "_start", "_stop", "_time", "_value", "pod", "uid"])
                      |> group(columns: ["pod"], mode:"by")
                      |> unique(column: "pod")
                      
                      
                      
                    podLabels = from(bucket: "${process.env.STAGE}-usage-data")
                    |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
                    |> filter(fn: (r) => r["businessID"] == "${businessID}")
                        |> filter(fn: (r) => r["_measurement"] == "meteringco_kube_pod_labels")
                        |> filter(fn: (r) => exists r.label_meteringco_service_id or exists r.label_meteringco_application_id)
                        |> filter(fn: (r) => exists r.pod)
                        |> group(columns: ["pod"], mode:"by")
                        |> unique(column:"pod")
                      
                        union(tables: [podLabels, ready])
                        |> group(columns: ["pod"], mode:"by") 
                        |> sort(columns:["_time"], desc: true)`;
        const res = queryApi.collectRows(fluxQuery);
        return res;
    };

    getLatestPodLabelsByID = async ({ podId, startTime, endTime, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `
                    from(bucket: "${process.env.STAGE}-usage-data")
                        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
                        |> filter(fn: (r) => r["businessID"] == "${businessID}")
                        |> filter(fn: (r) => r["_measurement"] == "meteringco_kube_pod_labels")
                        |> filter(fn: (r) => exists r.label_meteringco_customer_id)
                        |> filter(fn: (r) => exists r.label_meteringco_dimension_id)
                        |> filter(fn: (r) => exists r.pod)
                        |> filter(fn: (r) => r["pod"] == "${podId}")
                        |> group(columns: ["pod"], mode:"by")
                        |> last()`;
        const res = queryApi.collectRows<LabelPodInfluxRow>(fluxQuery);
        return res;
    };

    getMetricLoadTime = async ({ startTime, endTime, businessID }) => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `
        
        startMetricTime = from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.pod)
        |> sort(columns: ["_time"], desc: false)
        |> group(columns: ["pod"], mode:"by")
        |> first()
        
        endMetricTime = from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => exists r.pod)
        |> sort(columns: ["_time"], desc: false)
        |> group(columns: ["pod"], mode:"by")
        |> last()
        |> keep(columns: ["_time", "pod"])

        join(
            tables: {endMetricTime:endMetricTime, startMetricTime:startMetricTime},
            on: ["pod"],
        )              
        
        `;
        const res = queryApi.collectRows(fluxQuery);
        return res;
    };

    static determineAggregationWindowFunction(aggregationMethod, aggregationInterval, samplingFrequency): string {
        if (aggregationMethod === 'Count') {
            // Need to aggregate twice to remove duplicates in the sample
            return `aggregateWindow(every: ${aggregationInterval}m, fn: count, createEmpty: false) 
                    |> count()`;
        }
        if (aggregationMethod === 'Average') {
            return `aggregateWindow(every: ${aggregationInterval}m, fn: mean, createEmpty: false)`;
        }
    }
    static metadataFilterBuilder(filters: Array<MeteringCoFilters>) {
        return filters.reduce((acc, { key, values }) => {
            values.forEach((value) => {
                acc += `|> filter(fn: (r) => r["${key}"] == "${value}") \n`;
            });

            return acc;
        }, '');
    }

    getSingleDimension = async ({ businessID, dimensionId }: ReadDimensionDto): Promise<Array<any>> => {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${DimensionEntity._measurement}")
        |> filter(fn: (r) => r["dimensionId"] == "${dimensionId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "dimensionId")`;

        const res = queryApi.collectRows(fluxQuery);
        return res;
    };

    getLatestSettings({ businessID }): Promise<Array<any>> {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${SettingsEntity._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_measurement"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> unique(column: "businessID")`;

        const res = queryApi.collectRows<SettingInfluxRow>(fluxQuery);
        return res;
    }

    getInvoicesForCustomer({
        businessID,
        customerId,
        startDate,
        endDate,
        onlyOpenAndPaid,
    }: {
        businessID: string;
        customerId: string;
        startDate?: string;
        endDate?: string;
        onlyOpenAndPaid?: boolean;
    }): Promise<Array<any>> {
        const queryApi = this.dbclient.getQueryApi(this.org);
        let influxStartDate;
        let influxEndDate;
        if (startDate) {
            influxStartDate = new Date(startDate);
        } else {
            influxStartDate = new Date('January 1, 1970 00:00:00');
        }
        if (endDate) {
            influxEndDate = new Date(endDate);
        } else {
            influxEndDate = new Date();
        }
        let fluxQuery;
        if (onlyOpenAndPaid) {
            fluxQuery = `from(bucket: "${process.env.STAGE}-config")
            |> range(start: ${new Date(influxStartDate).toISOString()}, stop:${new Date(influxEndDate).toISOString()})
            |> filter(fn: (r) => r["_measurement"] == "${Invoice._measurement}")
            |> filter(fn: (r) => r["customerId"] == "${customerId}")
            |> filter(fn: (r) => r["businessID"] == "${businessID}")
            |> filter(fn: (r) => r["invoiceStatus"] == "Open" or r["invoiceStatus"] == "Paid")
            |> group(columns: ["_value"], mode:"by")
            |> sort(columns: ["_time"], desc: true)
            |> top(n: 1)`;
        } else {
            fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(influxStartDate).toISOString()}, stop:${new Date(influxEndDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Invoice._measurement}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_value"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> top(n: 1)`;
        }

        InfluxService.logger.debug(fluxQuery);
        const res = queryApi.collectRows<InvoiceInfluxRow>(fluxQuery);
        return res;
    }
    getAllInvoicesGroupedByCustomer({ businessID }) {
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Invoice._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_value"], mode:"by")
        |> sort(columns: ["_time"], desc: true)
        |> top(n: 1)
        |> group(columns: ["customerId"], mode:"by")`;
        const res = queryApi.collectRows<InvoiceInfluxRow>(fluxQuery);
        return res;
    }

    getSingleInvoice({ businessID, invoiceId }): Promise<Array<any>> {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const startDate = new Date('January 1, 1970 00:00:00');
        const endDate = new Date();
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Invoice._measurement}")
        |> filter(fn: (r) => r["invoiceId"] == "${invoiceId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_value"], mode:"by")
        |> sort(columns: ["_time"], desc: true)`;

        const res = queryApi.collectRows<InvoiceInfluxRow>(fluxQuery);
        return res;
    }
    getQueuedInvoicesForCustomer({ startTime, endTime, businessID, customerId }): Promise<Array<any>> {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `from(bucket: "${process.env.STAGE}-invoice-queue")
        |> range(start: ${new Date(startTime).toISOString()}, stop:${new Date(endTime).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Invoice._queueMeasurement}")
        |> filter(fn: (r) => r["customerId"] == "${customerId}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group()
        |> sort(columns: ["_time"], desc: true)`;
        const res = queryApi.collectRows<InvoiceInfluxRow>(fluxQuery);
        return res;
    }

    getAllInvoiceRevenue({ businessID, startDate, endDate }): Promise<Array<any>> {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const fluxQuery = `from(bucket: "${process.env.STAGE}-config")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${Invoice._measurement}")
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["_value"], mode: "by")
        |> sort(columns: ["_time"], desc: true)
        |> top(n: 1)
        |> filter(fn: (r) => r["invoiceStatus"] == "Open" or r["invoiceStatus"] == "Paid")
        `;
        const res = queryApi.collectRows<InvoiceInfluxRow>(fluxQuery);
        return res;
    }

    aggregateMonthlyComputeCosts({ businessID, startDate, endDate }): Promise<Array<any>> {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const averageEC2CostFluxQuery = `from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${PodCostEntity._measurement}")
        |> drop(columns:["timeDelta"])
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> group(columns: ["podId", "customerId", "cpu", "ram"], mode:"by")
        |> aggregateWindow(every: 1h, fn: mean)
        |> aggregateWindow(every: 1mo, fn: sum)
        |> group(columns: ["_time"], mode:"by")
        |> sum(column: "_value")`;

        const res = queryApi.collectRows<MonthlyCostInfluxRow>(averageEC2CostFluxQuery);

        return res;
    }
    aggregateMonthlyComputeCostsByCustomer({ businessID, startDate, endDate, customerIds }): Promise<Array<any>> {
        const queryApi = this.dbclient.getQueryApi(this.org);
        const averageEC2CostFluxQuery = `
        arrayValues = [${this.buildArrayValues(customerIds)}]
        
        from(bucket: "${process.env.STAGE}-usage-data")
        |> range(start: ${new Date(startDate).toISOString()}, stop:${new Date(endDate).toISOString()})
        |> filter(fn: (r) => r["_measurement"] == "${PodCostEntity._measurement}")
        |> drop(columns:["timeDelta"])
        |> filter(fn: (r) => r["businessID"] == "${businessID}")
        |> filter(fn: (r) => contains(value: r["customerId"], set: arrayValues))
        |> group(columns: ["podId", "customerId", "cpu", "ram"], mode:"by")
        |> aggregateWindow(every: 1h, fn: mean)
        |> aggregateWindow(every: 1mo, fn: sum)
        |> group(columns: ["_time"], mode:"by")
        |> sum(column: "_value")`;

        const res = queryApi.collectRows<MonthlyCostInfluxRow>(averageEC2CostFluxQuery);

        return res;
    }

    private buildArrayValues(values: Array<any>): string {
        let arrayValues = '';
        values.forEach((value, index) => {
            if (index === 0) {
                arrayValues += `"${value}"`;
            } else {
                arrayValues += `,"${value}"`;
            }
        });
        return arrayValues;
    }
}
