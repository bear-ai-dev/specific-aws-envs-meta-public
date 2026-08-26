import {
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InfluxService } from '../influx/influx.service.js';
import { EbsVolumeDataGathererEntity } from '../microservices/ebsVolumeDataGatherer/entities/ebsVolumeDataGatherer.entity.js';
import { ServicesService } from '../services/services.service.js';

import { CalculatedEbsCostEntity } from './entities/ebsCost.entity.js';

import { awsPriceLookup } from '../utils/aws/awsPricing.js';
import { FindCostResponse } from './dto/cost.dto.js';
import { InstanceUptimeEntity } from '../microservices/instanceUpTime/entities/instanceUptime.entity.js';
import { ReservedInstanceEntity } from '../microservices/reservedInstanceHistory/entities/reservedInstances.entity.js';
import { PodCostEntity, OnDemandInstanceEntity } from './entities/podCost.entity.js';
import flattenDeep from 'lodash.flattendeep';
import { joinedResults } from '../influx/utils/joinPodData.js';
import { Process, Processor } from '@nestjs/bull';
import { SchedulerEntity } from '../scheduler/entities/scheduler.entity.js';
import { Job } from 'bull';
import { ComputeCostSource } from '../setting/dto/update-settings.dto.js';

const ONE_HOUR_IN_SECONDS = 3600;

@Processor('scheduler_queue')
export class CostService {
    private static readonly logger = new Logger(CostService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => ServicesService)) readonly servicesService: ServicesService,
    ) {}
    private TIME_DELTA_ONE_HOUR = 1;

    public static calculatePastHourUptimeOfPods = (startStopDeleteTimesForPods = []) => {
        let previousTableValueCounter = -1;
        const filterdByCustomerId = startStopDeleteTimesForPods.filter(({ customerId }) => customerId);
        // Given a grouped by pod/meteringcoId and sorted table by time, we can calculate the uptime of a pod
        const groupedPods = filterdByCustomerId.reduce((acc, { table, node, pod: PodID, customerId }, arr) => {
            // If the acc doesn't have the pod / meteringcoId combination add it to the acc
            const combinedID = `${PodID}##${customerId}`;
            if (!acc[`${combinedID}`]) {
                acc[`${combinedID}`] = {
                    timeDelta: 1,
                    node,
                };
            }

            previousTableValueCounter = table;
            return acc;
        }, {});
        return groupedPods;
    };
    private static async ec2InstanceCost({ instanceType, region }): Promise<Array<Record<any, any>>> {
        CostService.logger.debug(`Looking up EC2 Instance Cost for ${instanceType} in ${region}`);
        const priceList = await awsPriceLookup(
            [
                {
                    Type: 'TERM_MATCH',
                    Field: 'ServiceCode',
                    Value: 'AmazonEC2',
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'regionCode',
                    Value: region,
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'instanceType',
                    Value: instanceType,
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'marketoption',
                    Value: 'OnDemand',
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'operatingSystem',
                    Value: 'Linux',
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'tenancy',
                    Value: 'Shared',
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'preInstalledSw',
                    Value: 'NA',
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'licenseModel',
                    Value: 'No License required',
                },
                {
                    Type: 'TERM_MATCH',
                    Field: 'capacitystatus',
                    Value: 'Used',
                },
            ],

            'AmazonEC2',
        );
        return priceList.map((price) => (price instanceof String ? price.toJSON() : JSON.parse(price)));
    }

    private static countPodsPerNode(arrayOfPodTimeDeltasAndNodeIds): Array<any> {
        // Count the number of pods per node
        // Return each object of the original array with the number of pods per node

        const nodeCountPerPod = arrayOfPodTimeDeltasAndNodeIds.reduce((acc, { node }) => {
            if (!acc[node]) {
                acc[node] = 1;
            } else {
                acc[node] += 1;
            }
            return acc;
        }, {});

        return arrayOfPodTimeDeltasAndNodeIds.map((pod) => ({
            ...pod,
            podCountPerNode: nodeCountPerPod[pod.node],
        }));
    }
    @Process({ name: ComputeCostSource.eks })
    async getAndCommitPODCost({ data: { businessID } }: Job<SchedulerEntity>) {
        CostService.logger.debug('Getting and committing pod cost');
        const now = new Date();

        try {
            const startTime = new Date(now.getTime() - ONE_HOUR_IN_SECONDS * 1000);
            const endTime = now.getTime();

            const startStopDeleteTimesForPods = await this.InfluxService.getAllStartStopTimesForPodsInBusiness({
                businessID,
                startTime,
                endTime,
            });
            const joinedPods = joinedResults(startStopDeleteTimesForPods);
            const arrayOfPods = Object.keys(joinedPods).map((pod) => ({ ...joinedPods[pod], pod }));
            const groupedPods = CostService.calculatePastHourUptimeOfPods(arrayOfPods);
            CostService.logger.debug(`runningPods Response Length: ${JSON.stringify(groupedPods)}`);
            CostService.logger.debug(`runningPods Response Length: ${Object.keys(groupedPods).length}`);
            // Get running instances filter by node name from running pods
            const runningInstancesKeys = Object.keys(groupedPods);
            const unfilteredInstances = await Promise.all(
                runningInstancesKeys.map(async (groupedPodAndMeteringCoId) => {
                    const { node } = groupedPods[groupedPodAndMeteringCoId];
                    CostService.logger.debug(`groupedPodAndMeteringCoId: Node :::: ${groupedPodAndMeteringCoId}: ${node}`);
                    if (!node) {
                        CostService.logger.warn('No node found for pod: ', groupedPodAndMeteringCoId);
                        return;
                    }
                    const dbModels = await this.InfluxService.getEC2InstanceData({
                        businessID,
                        privateDNS: node,
                    });
                    const [podId, customerId] = groupedPodAndMeteringCoId.split('##');
                    return dbModels.map((dbModel) => ({
                        ...InstanceUptimeEntity.dbModelToEntity(dbModel),
                        ...groupedPods[groupedPodAndMeteringCoId],
                        customerId,
                        podId,
                    }));
                }),
            );
            const runningInstances = flattenDeep(unfilteredInstances.filter((instance) => instance));

            // Get reserved instances count
            const reservedInstanceDbModelList = await this.InfluxService.getReservedInstances({ businessID });
            CostService.logger.debug(`reservedInstanceDbModelList Length: ${reservedInstanceDbModelList.length}`);
            const reservedInstanceEntities = reservedInstanceDbModelList.map((dbModel) =>
                ReservedInstanceEntity.dbModelToEntity(dbModel),
            );
            const copyOfReservedInstanceEntities = JSON.parse(JSON.stringify(reservedInstanceEntities));
            // Combine the reservedInstance list with the running instances list, tag the running instances with the reserved instance
            const instanceMap = {};
            const combinedInstances = CostService.countPodsPerNode(runningInstances).map((runningInstance) => {
                const reservedInstanceIndex = copyOfReservedInstanceEntities.findIndex(
                    (reservedInstance) => reservedInstance.instanceType === runningInstance.instanceType,
                );
                let reservedInstance = false;
                if (reservedInstanceIndex !== -1 && !instanceMap[runningInstance.instanceID]) {
                    // if the instance type is found in the reserved instance list, and the instance id is not already reserved
                    instanceMap[runningInstance.instanceID] = true;
                    reservedInstance = copyOfReservedInstanceEntities.splice(reservedInstanceIndex, 1);
                }
                return {
                    ...runningInstance,
                    isReserved: reservedInstance ? true : false,
                    ...(reservedInstance && { reservedInstance }),
                };
            });
            CostService.logger.debug(`combinedInstances Instances Length: ${combinedInstances.length}`);
            // create a Set of instance types and regions, and operating system and type (On demand or reserved)
            const instanceTypeSet = new Set();
            combinedInstances.forEach(({ instanceType, region }) => {
                if (instanceType && region) {
                    instanceTypeSet.add(`${instanceType}##${region}`);
                } else {
                    CostService.logger.warn(
                        `Instance Type or Region not found for instance: ${instanceType} :: ${region}`,
                    );
                }
            });
            const priceLists = [];

            // for each element in the set
            // get the price list
            instanceTypeSet.forEach((val) => {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                //@ts-ignore
                const [instanceType, region] = val.split('##');
                CostService.logger.debug(`instanceType: ${instanceType} :: region: ${region}`);
                priceLists.push(CostService.ec2InstanceCost({ instanceType, region }));
            });
            CostService.logger.debug(`priceLists Length: ${priceLists.length}`);

            const resolvedPriceList = flattenDeep(await Promise.all(priceLists));

            const onDemandPriceDocs = resolvedPriceList.reduce((acc, item) => {
                const {
                    terms: { OnDemand },
                    product: { attributes },
                } = JSON.parse(item);
                const skuKeys = Object.keys(OnDemand);
                if (skuKeys.length !== 1) {
                    throw new Error(`Expected 1 SKU Key, got ${skuKeys.length}`);
                }
                const sku = skuKeys[0];
                const { regionCode, instanceType } = attributes;
                const priceDimensionSku = Object.keys(OnDemand[sku].priceDimensions);
                if (priceDimensionSku.length !== 1) {
                    throw new Error(`Expected 1 SKU Key, got ${priceDimensionSku.length}`);
                }
                const {
                    unit,
                    pricePerUnit: { USD },
                } = OnDemand[sku].priceDimensions[priceDimensionSku[0]];
                const onDemandInstanceEntity = new OnDemandInstanceEntity({ unit, pricePerUnit: USD });
                if (!acc[regionCode]) {
                    acc[regionCode] = {};
                }
                acc[regionCode][instanceType] = onDemandInstanceEntity;
                return acc;
            }, {});
            // Build a cost document input for each instance
            // Calculate the cost for each instance
            CostService.logger.debug(`combinedInstances Length: ${combinedInstances.length}`);
            const entites = combinedInstances.map((instance): PodCostEntity => {
                const {
                    timeDelta,
                    customerId,
                    podId,
                    cpu,
                    ram,
                    reservedInstance,
                    instanceID,
                    status,
                    podCountPerNode,
                } = instance;
                const unitPrice = PodCostEntity.determineUnitPrice({
                    instanceType: instance.instanceType,
                    priceDocument: onDemandPriceDocs[instance.region][instance.instanceType],
                    isReserved: instance.isReserved,
                    ReservedInstanceEntity: reservedInstance?.length ? reservedInstance[0] : undefined,
                });
                const hourlyComputeCost = PodCostEntity.calculateCost({ unitPrice, timeDelta, podCountPerNode });

                const costEntity = new PodCostEntity({
                    businessID,
                    hourlyComputeCost,
                    customerId,
                    podId,
                    cpu,
                    ram,
                    timeDelta,
                    instanceId: instanceID,
                    instanceStatus: status?.Name,
                });
                return costEntity;
            });
            const points = entites.map((entity) => PodCostEntity.transformer(entity, this.InfluxService));
            const { loadPoints } = this.InfluxService;

            await loadPoints(`${process.env.STAGE}-usage-data`, process.env.INFLUX_ORG, points);
        } catch (error) {
            if (parseInt(error.status) === 404) {
                CostService.logger.warn(`No Customers Found for businessID: ${businessID}`);
                return;
            }
            CostService.logger.error('Error Occurred', error);
        }

        // Load the cost into influx
    }

    async findAggregateCost({ businessID }): Promise<FindCostResponse> {
        const aggregateData = await this.InfluxService.readAverageEBSCost({ businessID });
        if (!aggregateData.length) {
            return {
                data: [],
                message: 'No EBS cost data found. Data is updated every hour, check tags on EBS Volumes.',
            };
        }
        // TODO Read Average Node Cost and return it
        const dto = aggregateData.map((data) => CalculatedEbsCostEntity.dbModelToDTO(data));

        return { message: 'Found Cost Response', data: dto };
    }

    async findCostCompute({ businessID }): Promise<FindCostResponse> {
        const aggregateData = await this.InfluxService.readAverageEC2Cost({ businessID });
        if (!aggregateData.length) {
            return {
                data: [],
                message: 'No EC2 cost data found. Data is updated every hour, check tags on Pods or Instances.',
            };
        }
        // TODO Read Average Node Cost and return it
        const dto = aggregateData.map((data) => PodCostEntity.averageCostsConverterToDto(data));

        return { message: 'Found Cost Response', data: dto };
    }
}
