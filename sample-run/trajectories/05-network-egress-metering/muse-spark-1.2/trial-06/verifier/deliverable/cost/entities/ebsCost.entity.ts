import { InternalServerErrorException, Logger } from '@nestjs/common';
import { EBSStorageCostEntity } from '../../influx/entities/ebsStorageCostEntity.js';
import { InfluxService } from '../../influx/influx.service.js';
import { EbsVolumeDataGathererEntity } from '../../microservices/ebsVolumeDataGatherer/entities/ebsVolumeDataGatherer.entity.js';
import { SupportedCurrencies } from '../../offering/dto/SupportedCurrencies.js';
import { ServiceEntity } from '../../services/entities/service.entity.js';
import { FindEBSCostResponseData, supportedEBSTypes } from '../dto/cost.dto.js';

export class EBSCostEntity {
    private static readonly logger = new Logger(EBSCostEntity.name);
    public static _measurement = 'ebsCost';

    public businessID: string;
    public storageUnitCost?: number;
    public throughputUnitCost?: number;
    public iopsUnitCosts?: Array<IOPSUnitCostRanges>;
    public freeIops: number;
    public timeDelta: number;

    public volumeID: EbsVolumeDataGathererEntity['volumeID'];
    public size: EbsVolumeDataGathererEntity['size'];
    public iops: EbsVolumeDataGathererEntity['iops'];
    public volumeType: EbsVolumeDataGathererEntity['volumeType'];
    public tags: EbsVolumeDataGathererEntity['tags'];
    public state: EbsVolumeDataGathererEntity['state'];
    public throughput: EbsVolumeDataGathererEntity['throughput'];
    public availabilityZone: EbsVolumeDataGathererEntity['availabilityZone'];
    public region: EbsVolumeDataGathererEntity['region'];
    public serviceId: ServiceEntity['serviceId'];

    constructor({
        businessID,
        storageUnitCost,
        volumeID,
        size,
        iops,
        volumeType,
        tags,
        state,
        throughput,
        availabilityZone,
        freeIops,
        timeDelta,
        iopsUnitCosts,
        serviceId,
    }: EBSCostEntity) {
        this.businessID = businessID;
        this.storageUnitCost = storageUnitCost;
        this.iopsUnitCosts = iopsUnitCosts;
        this.volumeID = volumeID;
        this.size = size;
        this.iops = iops;
        this.volumeType = volumeType;
        this.tags = tags;
        this.state = state;
        this.throughput = throughput;
        this.availabilityZone = availabilityZone;
        this.freeIops = freeIops;
        this.timeDelta = timeDelta;
        this.serviceId = serviceId;
    }

    public static convertAWSPriceListToUnitCostClasses(priceList): Array<IOPSUnitCostRanges> {
        return priceList.map((priceDoc) => {
            const parsedDoc = JSON.parse(priceDoc);
            const {
                product: {
                    attributes: { usagetype: usageType },
                },
            } = parsedDoc;
            EBSCostEntity.logger.debug(`UsageType`, usageType);
            const [AWSServiceAPIName, usageNameAndClass] = usageType.split(':');
            if (AWSServiceAPIName !== 'EBS' && AWSServiceAPIName !== 'EU-EBS') {
                throw new InternalServerErrorException(
                    `Invalid AWS Service API Name: ${AWSServiceAPIName}, should be "EBS"`,
                );
            }
            const arrayOfAWSUsageTypeInfo = usageNameAndClass.split('.');
            if (arrayOfAWSUsageTypeInfo.length !== 2) {
                const [usageName, ClassForAWSProduct, tier] = arrayOfAWSUsageTypeInfo;
                return EBSCostEntity.getClassForUsageName(usageName, ClassForAWSProduct, parsedDoc, tier);
            } else {
                const [usageName, ClassForAWSProduct] = arrayOfAWSUsageTypeInfo;
                return EBSCostEntity.getClassForUsageName(usageName, ClassForAWSProduct, parsedDoc);
            }
        });
    }

    public static getPriceDimensionFromPriceList(priceList) {
        const {
            terms: { OnDemand },
        } = priceList;
        const skuKeys = Object.keys(OnDemand);
        if (skuKeys.length !== 1) {
            throw new InternalServerErrorException(`Invalid SKU Keys cost cost lookup: ${skuKeys} should only be 1`);
        }
        const skuKey = skuKeys[0];
        const priceDimensionSku = Object.keys(OnDemand[skuKey].priceDimensions);
        if (priceDimensionSku.length !== 1) {
            throw new InternalServerErrorException(
                `Invalid priceDimensionSku Keys cost lookup: ${priceDimensionSku} should only be 1`,
            );
        }
        const priceDimension = OnDemand[skuKey].priceDimensions[priceDimensionSku[0]];
        return priceDimension;
    }
    public static getClassForUsageName(usageName: string, volumeType: supportedEBSTypes, priceList, tier?: string) {
        const {
            unit,
            pricePerUnit: { USD: costPerUnitInUSD },
        } = EBSCostEntity.getPriceDimensionFromPriceList(priceList);
        if (usageName === 'VolumeUsage') {
            return new StorageUnitCostRanges({
                unit,
                cost: costPerUnitInUSD,
                currency: SupportedCurrencies['USD'],
                startRange: 0,
                endRange: 'Inf',
            });
        }
        if (usageName === 'VolumeP-IOPS') {
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            //@ts-ignore
            if (volumeType === 'io2') {
                if (!tier) {
                    return new IOPSUnitCostRanges({
                        unit,
                        cost: costPerUnitInUSD,
                        currency: SupportedCurrencies['USD'],
                        startRange: 0,
                        endRange: 32000,
                    });
                }
                if (tier === 'tier2') {
                    return new IOPSUnitCostRanges({
                        unit,
                        cost: costPerUnitInUSD,
                        currency: SupportedCurrencies['USD'],
                        startRange: 32000,
                        endRange: 64000,
                    });
                }
                if (tier === 'tier3') {
                    return new IOPSUnitCostRanges({
                        unit,
                        cost: costPerUnitInUSD,
                        currency: SupportedCurrencies['USD'],
                        startRange: 64000,
                        endRange: 'Inf',
                    });
                }
            } else if (volumeType === 'gp3') {
                return new IOPSUnitCostRanges({
                    unit,
                    cost: costPerUnitInUSD,
                    currency: SupportedCurrencies['USD'],
                    startRange: 0,
                    endRange: 'Inf',
                    freeIopsAmount: 3000,
                });
            } else {
                return new IOPSUnitCostRanges({
                    unit,
                    cost: costPerUnitInUSD,
                    currency: SupportedCurrencies['USD'],
                    startRange: 0,
                    endRange: 'Inf',
                });
            }
        }

        if (usageName === 'VolumeP-Throughput') {
            return new ThroughPutUnitCostRanges({
                unit,
                cost: costPerUnitInUSD,
                currency: SupportedCurrencies['USD'],
                startRange: 0,
                endRange: 'Inf',
            });
        }
        throw new InternalServerErrorException(`Invalid usage name: ${usageName}`);
    }
    public static calculateCost(ebsCostEntity: EBSCostEntity): CalculatedEbsCostEntity {
        const {
            storageUnitCost,
            iopsUnitCosts,
            size,
            iops,
            timeDelta,
            freeIops,
            volumeID,
            businessID,
            serviceId,
            volumeType,
            throughput,
        } = ebsCostEntity;
        const sortedCostRanges = iopsUnitCosts.sort((a, b) => a.startRange - b.startRange);
        const IopsAfterFreeTier = iops - freeIops;
        const chunkedIopsRanges = sortedCostRanges.map((costRange) => {
            const { startRange, endRange, cost } = costRange;
            if (endRange === 'Inf') {
                const iopsRange = IopsAfterFreeTier - startRange;
                const iopsCost = cost * iopsRange;
                return { startRange, endRange, iopsRange, totalIops: IopsAfterFreeTier, iopsCost };
            }
            if (endRange > iops) {
                const iopsRange = IopsAfterFreeTier - startRange;
                const iopsCost = cost * iopsRange;
                return { startRange, endRange, iopsRange, totalIops: iops, iopsCost };
            }
            const iopsRange = endRange - startRange;
            const iopsCost = cost * iopsRange;
            return { startRange, endRange, iopsRange, totalIops: iops, iopsCost };
        });

        const iopsTieredTotalCost = chunkedIopsRanges.reduce((acc, curr) => acc + curr.iopsCost, 0);
        EBSCostEntity.logger.debug(
            `size: ${size} ${typeof size} storageUnitCost: ${storageUnitCost} ${typeof storageUnitCost} timeDelta: ${timeDelta} ${typeof timeDelta} `,
        );
        const totalStorageCost = size * storageUnitCost * timeDelta;
        EBSCostEntity.logger.debug(` IopsTieredTotalCost: ${iopsTieredTotalCost} ${typeof iopsTieredTotalCost}`);
        const totalIopsCost = iopsTieredTotalCost * timeDelta;
        EBSCostEntity.logger.debug(` totalStorageCost: ${totalStorageCost} ${typeof totalStorageCost}`);
        return new CalculatedEbsCostEntity({
            totalIopsCost,
            totalStorageCost,
            totalCost: totalIopsCost + totalStorageCost,
            timeDelta,
            volumeID,
            businessID,
            serviceId,
            volumeType,
            iops,
            storageSize: size,
            throughput: throughput,
        });
    }
}
export function getDaysInCurrentMonth() {
    const date = new Date();

    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export class CalculatedEbsCostEntity {
    public static _measurement = 'calculatedEbsCost';

    public businessID: string;
    public volumeID: string;
    public totalIopsCost: number;
    public totalStorageCost: number;
    public totalCost: number;
    public timeDelta: number;
    public iops: EBSCostEntity['iops'];
    public storageSize: EBSCostEntity['size'];
    public throughput: EBSCostEntity['throughput'];

    public serviceId: ServiceEntity['serviceId'];
    public volumeType: EBSCostEntity['volumeType'];

    constructor({
        businessID,
        volumeID,
        totalIopsCost,
        totalStorageCost,
        totalCost,
        timeDelta,
        serviceId,
        volumeType,
        iops,
        storageSize,
        throughput,
    }: CalculatedEbsCostEntity) {
        this.businessID = businessID;
        this.volumeID = volumeID;
        this.totalIopsCost = totalIopsCost;
        this.totalStorageCost = totalStorageCost;
        this.totalCost = totalCost;
        this.timeDelta = timeDelta;
        this.serviceId = serviceId;
        this.volumeType = volumeType;
        this.iops = iops;
        this.storageSize = storageSize;
        this.throughput = throughput;
    }

    public static transformer(calculatedEbsCostEntity: CalculatedEbsCostEntity, influxService: InfluxService) {
        const {
            businessID,
            volumeID,
            totalIopsCost,
            totalStorageCost,
            totalCost,
            timeDelta,
            serviceId,
            volumeType,
            iops,
            storageSize,
            throughput,
        } = calculatedEbsCostEntity;
        const { getPoint } = influxService;
        const point = getPoint(CalculatedEbsCostEntity._measurement);
        point.tag('businessID', businessID);
        point.tag('volumeID', volumeID);
        point.tag('totalIopsCost', totalIopsCost.toString());
        point.tag('totalStorageCost', totalStorageCost.toString());
        point.tag('serviceId', serviceId);
        point.tag('volumeType', volumeType);
        point.tag('iops', iops.toString());
        point.tag('storageSize', storageSize.toString());
        point.tag('throughput', throughput.toString());

        point.floatField('totalCost', totalCost);

        point.tag('timeDelta', timeDelta.toString());
        return point;
    }
    public static dbModelToDTO(ebsStorageCostEntity: EBSStorageCostEntity): FindEBSCostResponseData {
        const { _value, iops, storageSize, throughput } = ebsStorageCostEntity;
        return {
            iops: iops.toString(),
            size: storageSize.toString(),
            throughput: throughput.toString(),
            averageUnitCost: _value.toString(),
        };
    }
}

export class IOPSUnitCostRanges {
    startRange: number;
    endRange: number | 'Inf';
    cost: number;
    unit: string;
    currency: SupportedCurrencies;
    freeIopsAmount?: number;

    constructor({ startRange, endRange, cost, currency, freeIopsAmount }: IOPSUnitCostRanges) {
        this.startRange = startRange;
        this.endRange = endRange;
        this.cost = cost / (getDaysInCurrentMonth() * 24);
        this.unit = 'IOPS-Hour';
        this.currency = currency;
        this.freeIopsAmount = freeIopsAmount;
    }
}

export class ThroughPutUnitCostRanges {
    startRange: number;
    endRange: number | 'Inf';
    cost: number;
    unit: string;
    currency: SupportedCurrencies;

    constructor({ startRange, endRange, cost, unit, currency }: ThroughPutUnitCostRanges) {
        this.startRange = startRange;
        this.endRange = endRange;
        this.cost = cost / (getDaysInCurrentMonth() * 24);
        this.unit = unit;
        this.currency = currency;
    }
}

export class StorageUnitCostRanges {
    startRange: number;
    endRange: number | 'Inf';
    cost: number;
    unit: string;
    currency: SupportedCurrencies;

    constructor({ startRange, endRange, cost, currency }: StorageUnitCostRanges) {
        this.startRange = startRange;
        this.endRange = endRange;
        this.cost = cost / (getDaysInCurrentMonth() * 24);
        this.unit = 'GB-Hour';
        this.currency = currency;
    }
}
