import { Logger } from '@nestjs/common';
import { ApiHideProperty, OmitType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsISO8601 } from 'class-validator';
import { ReadDimensionResponseData } from 'dimensions/dto/create-dimension.dto.js';

import { aggregationInterval, aggregationIntervalInMS, SampleType } from '../dimensions/dto/create-dimension.dto.js';
import { ReadOfferingResponseData } from '../offering/dto/readOffering.dto.js';
import { UsageDocument } from '../usage/dto/read-usage.dto.js';
import { InfluxService } from './influx.service.js';
import { DiscoverServiceDto } from './dto/discoverService.dto.js';
import { DiscoveryServiceEntity } from './entities/discovery.entity.js';

import { SupportedResources } from '../measurement-config/entities/measurement-config.entity.js';
import { MeasurementFormat } from '../measurement-config/entities/measurement.interface.js';
import {
    AggregatedUsageResponse,
    BasicUsageDocument,
    MetadataGroupedAggregatedUsageResponse,
    UnAggregatedUsageResponse,
    UsageResponseDocument,
} from '../customer/dto/read-customer.dto.js';
import { AggregationPurpose } from '../customer/dto/AggregationPurpose.js';
import { CreateUsageDto } from '../usage/dto/create-usage.dto.js';
import { AggregatedUsageRow } from './entities/usageRow.entity.js';

const { usageData } = SupportedResources;
export class InfluxAggregateUsageEvent {
    private static readonly logger = new Logger(InfluxAggregateUsageEvent.name);
    public customerId: string;
    public offeringDocument: ReadOfferingResponseData;

    /**
     * TThe unique identifier for the SaaS business
     * @example HarperDB
     */
    @ApiHideProperty()
    @IsString()
    @IsNotEmpty()
    public businessID: string;

    @IsString()
    @IsNotEmpty()
    @IsISO8601()
    public startTime: string;

    @IsString()
    @IsNotEmpty()
    @IsISO8601()
    @IsOptional()
    public endTime: string;

    public influxService: InfluxService;

    public clientID: string;

    public applicationId?: string;

    public aggregationPurpose?: AggregationPurpose;
    private static aggregateDimensionUsageFunction = async ({
        businessID,
        startTime,
        endTime,
        influxService,
        dimension,
        customerId,
        aggregationPurpose,
    }: {
        businessID: string;
        startTime: string;
        endTime: string;
        influxService: InfluxService;
        dimension: ReadDimensionResponseData;
        customerId: string;
        aggregationPurpose: AggregationPurpose;
    }): Promise<AggregatedUsageRow[]> => {
        const {
            dimensionId,
            aggregationInterval: argumentAgg,
            aggregationMethod,
            rounding,
            usageIncrement,
        } = dimension as ReadDimensionResponseData;
        const { aggregateDimensionUsageQuery } = influxService as InfluxService;
        let data: AggregatedUsageRow[];
        const metadataGroups =
            dimension.tiersGroupByMetadata && dimension?.tiersGroupByMetadata.length > 0
                ? dimension.tiersGroupByMetadata[0]?.metadataGroups
                : undefined;
        if (dimension?.sampleType === SampleType.continious) {
            data = await aggregateDimensionUsageQuery({
                dimensionId,
                businessID,
                startDate: new Date('January 1, 2023 00:00:00'),
                endDate: new Date(endTime),
                aggregationInterval: argumentAgg,
                argumentAggregationMethod: aggregationMethod,
                customerId,
                rounding,
                usageIncrement: parseInt(usageIncrement),
                aggregationPurpose,
                queryStartTime: new Date(startTime),
                continious: true,
                metadataGroups,
            });
        } else {
            data = await aggregateDimensionUsageQuery({
                dimensionId,
                businessID,
                startDate: new Date(startTime),
                endDate: new Date(endTime),
                aggregationInterval: argumentAgg,
                argumentAggregationMethod: aggregationMethod,
                customerId,
                rounding,
                usageIncrement: parseInt(usageIncrement),
                aggregationPurpose,
                queryStartTime: new Date(startTime),
                continious: false,
                metadataGroups,
            });
        }

        return data;
    };

    private static dimensionFunctionMap = {
        [usageData]: async ({
            businessID,
            startTime,
            endTime,
            influxService,
            dimension,
            customerId,
            aggregationPurpose,
        }: SingleUsageEvent): Promise<BasicUsageDocument[] | UsageResponseDocument[]> => {
            const { dimensionId, aggregationInterval: argumentAgg } = dimension as ReadDimensionResponseData;
            const { dimensionUsageNoAggregation } = influxService as InfluxService;
            const metadataGroups = dimension.tiersGroupByMetadata?.[0]?.metadataGroups;
            if (argumentAgg !== aggregationInterval.none) {
                const data = await InfluxAggregateUsageEvent.aggregateDimensionUsageFunction({
                    businessID,
                    startTime,
                    endTime,
                    influxService,
                    dimension,
                    customerId,
                    aggregationPurpose,
                });
                // if there is no data, break up the time range into aggregation intervals, and return 0 for each interval.
                if (data?.length === 0) {
                    const start = new Date(startTime);
                    const end = new Date(endTime);
                    const interval = end.getTime() - start.getTime();
                    const intervalInMilliseconds = aggregationIntervalInMS[argumentAgg];
                    const numberOfIntervals = Math.ceil(interval / intervalInMilliseconds);
                    const aggregatedResults = [];
                    for (let i = 0; i < numberOfIntervals; i++) {
                        aggregatedResults.push(
                            new UsageDocument({
                                value: '0',
                                startTime: new Date(start.getTime() + i * intervalInMilliseconds).toISOString(),
                                endTime: new Date(start.getTime() + (i + 1) * intervalInMilliseconds).toISOString(),
                            }),
                        );
                    }
                    return aggregatedResults as UsageResponseDocument[];
                }

                const aggregatedResults = data.map(
                    ({ _value, _time, ...rest }, index, array): UsageResponseDocument => {
                        const value = _value === null ? '0' : _value?.toString();
                        const metadataGroup = {};
                        if (metadataGroups) {
                            Object.keys(rest).forEach((key) => {
                                if (key.startsWith('metadata_') && rest[key]) {
                                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                                    // @ts-ignore
                                    metadataGroup[key.replace('metadata_', '')] = JSON.parse(rest[key]);
                                }
                            });
                        }
                        if (array.length > 1 && index === array.length - 1) {
                            return new UsageDocument({
                                value,
                                startTime: array[index - 1]?._time,
                                endTime: endTime,
                                metadataGroup,
                            });
                        } else if (index === 0) {
                            return new UsageDocument({
                                value,
                                startTime: startTime,
                                endTime: _time,
                                metadataGroup,
                            });
                        } else {
                            return new UsageDocument({
                                value,
                                startTime: array[index - 1]?._time,
                                endTime: _time,
                                metadataGroup,
                            });
                        }
                    },
                );
                return aggregatedResults as UsageResponseDocument[];
            } else {
                const data = await dimensionUsageNoAggregation({
                    dimensionId,
                    businessID,
                    startDate: new Date(startTime),
                    endDate: new Date(endTime),
                    customerId,
                });
                const unAggregregatedResults = data.map((row) => {
                    const { businessID, _measurement, dimensionId, customerId, ...rest } =
                        MeasurementFormat.toEntity(row);
                    return { ...rest, recordValue: rest?.recordValue?.toString() };
                });
                return unAggregregatedResults as BasicUsageDocument[];
            }
        },
    };

    static buildAggregationQueries = async ({
        offeringDocument,
        ...rest
    }: InfluxAggregateUsageEvent): Promise<
        Array<UnAggregatedUsageResponse | AggregatedUsageResponse | MetadataGroupedAggregatedUsageResponse[]>
    > => {
        const results = await Promise.all(
            offeringDocument.dimensions.map(async ({ dimensionId, ...dimensionRest }) => {
                if (
                    dimensionRest?.tiersGroupByMetadata?.length > 0 &&
                    dimensionRest?.aggregationInterval !== aggregationInterval.none
                ) {
                    const usage = (await InfluxAggregateUsageEvent.dimensionFunctionMap['usageData']({
                        dimension: { ...dimensionRest, dimensionId },
                        ...rest,
                    })) as UsageResponseDocument[];
                    const groupedUsage = usage.reduce((acc, { metadataGroup, ...rest }) => {
                        if (acc[JSON.stringify(metadataGroup)]) {
                            acc[JSON.stringify(metadataGroup)].push(rest);
                        } else {
                            acc[JSON.stringify(metadataGroup)] = [rest];
                        }
                        return acc;
                    }, {});
                    return Object.keys(groupedUsage).map((key) => {
                        const metadataGroupedUsage: MetadataGroupedAggregatedUsageResponse = {
                            offeringId: offeringDocument?.offeringId,
                            dimensionId,
                            metadataGroup: JSON.parse(key),
                            usage: groupedUsage[key],
                        };

                        return metadataGroupedUsage;
                    });
                } else {
                    return {
                        offeringId: offeringDocument?.offeringId,
                        dimensionId,
                        usage: await InfluxAggregateUsageEvent.dimensionFunctionMap['usageData']({
                            dimension: { ...dimensionRest, dimensionId },
                            ...rest,
                        }),
                    };
                }
            }),
        );
        return results as Array<UnAggregatedUsageResponse | AggregatedUsageResponse>;
    };
    public static discover = async (
        {
            businessID,
            startTime = new Date('January 1, 1970 00:00:00'),
            endTime = new Date(),
            limit = 100,
            offset = 0,
            metadataFilters,
            sort,
        }: DiscoverServiceDto,
        InfluxService: InfluxService,
    ): Promise<{
        message: string;
        data: Array<DiscoveryServiceEntity>;
        limit: number;
        totalPods: number;
        totalUptime: number;
    }> => {
        // Given a businessID, startDate, and endDate
        // Query for all Infrastructure MeteringCo knows about in that date time range
        // Just focus on K8s for now
        // Get all unique POD ids in this time frame
        const { getUsageForKubernetesPods } = InfluxService;

        const results = await getUsageForKubernetesPods({ startTime, endTime, businessID, filters: metadataFilters });
        // Query for each pod ID
        // Below is the assocaited metric name in influx, and a tranformation function for that name which takes the input of the influx row, and returns a tranformed object which can be
        // spread into the pod's entity object argument
        const allowedMetrics = {
            container_cpu_usage_seconds_total: ({ _value }) => {
                return {
                    cpuSeconds: _value,
                };
            },
            container_memory_max_usage_bytes: (row) => {
                return {
                    memoraryBytes: row._value,
                };
            },
            container_network_receive_bytes_total: (row) => {
                return {
                    dataTransferBytesRecieved: row._value,
                };
            },
            container_network_transmit_bytes_total: (row) => {
                return {
                    dataTransferBytesTransmitted: row._value,
                };
            },
            kube_pod_start_time: (row) => {
                return {
                    podStartTimeInSeconds: row._value,
                };
            },
            kube_pod_deletion_timestamp: (row) => {
                return {
                    podDeletetionTime: row._value,
                };
            },
            kube_pod_completion_time: (row) => {
                return {
                    podCompletionTimeInSeconds: row._value,
                };
            },
        };
        const meteringcoMetaDataFields = {
            // Add Ginoel Teng on LinkedIn and tell him thanks for this piece of code.
            // One liners are great
            kube_pod_labels: (row) =>
                Object.keys(row)
                    .filter((key) => /label/.test(key))
                    .reduce((acc, key) => {
                        acc[key] = row[key];
                        return acc;
                    }, {}),

            _time_endMetricTime: ({ _time_endMetricTime }) => {
                return {
                    meteringcoRecievedLastMetricTime: _time_endMetricTime,
                };
            },
            _time_startMetricTime: ({ _time_startMetricTime }) => {
                return {
                    meteringcoRecievedFirstMetricTime: _time_startMetricTime,
                };
            },
        };

        const manualOverrides = {
            manual_pod_end_time: ({ _value }) => {
                return { manual_pod_end_time: _value };
            },
            manual_pod_start_time: ({ _value }) => {
                return { manual_pod_start_time: _value };
            },
        };
        const groupedData = results.reduce((acc, item) => {
            if (!acc[item.pod]) {
                acc[item.pod] = {};
            }
            if (!acc[item.pod['serviceType']]) {
                acc[item.pod]['serviceType'] = 'EC2'; // Needs to be data driven in the future, for now its static
            }

            if (!acc[item.pod['ID']] && item?.pod) {
                acc[item.pod]['ID'] = item.pod;
            }

            if (!acc[item.pod['infrastructureType']] && item?.node_kubernetes_io_instance_type) {
                acc[item.pod]['infrastructureType'] = item.node_kubernetes_io_instance_type;
            }

            if (!acc[item.pod['region']] && item?.topology_kubernetes_io_region) {
                acc[item.pod]['region'] = item.topology_kubernetes_io_region;
            }

            if (!acc[item.pod['hostOperatingSystem']] && item?.beta_kubernetes_io_os) {
                acc[item.pod]['hostOperatingSystem'] = item.beta_kubernetes_io_os;
            }

            try {
                const tranfomerFunc = allowedMetrics[item.__name__];
                if (tranfomerFunc) {
                    // method copies all enumerable own properties from one or more source
                    acc[item.pod] = Object.assign(acc[item.pod], tranfomerFunc(item));
                    return acc;
                } else if (
                    Object.keys(item).some((key) => Object.keys(meteringcoMetaDataFields).includes(key)) ||
                    item.__name__ === 'kube_pod_labels' // Workaround for some BS
                ) {
                    const metadataFields = Object.keys(meteringcoMetaDataFields);

                    metadataFields.forEach((metadataFieldKey) => {
                        let additionalMetadataFunc;
                        if (item.__name__ === 'kube_pod_labels') {
                            additionalMetadataFunc = meteringcoMetaDataFields[item.__name__];
                        } else {
                            additionalMetadataFunc = meteringcoMetaDataFields[metadataFieldKey];
                        }
                        if (acc[item.pod]?.metadata) {
                            console.log(acc[item.pod].metadata, 'Before Change');
                            acc[item.pod].metadata = { ...acc[item.pod].metadata, ...additionalMetadataFunc(item) };
                            console.log(acc[item.pod].metadata, 'After Change');
                        } else {
                            acc[item.pod].metadata = { ...additionalMetadataFunc(item) };
                        }
                        //acc[item.pod] = Object.assign(acc[item.pod], additionalMetadataFunc(item));
                    });
                    return acc;
                }
            } catch (error) {
                InfluxAggregateUsageEvent.logger.error(error);
                InfluxAggregateUsageEvent.logger.log('Error occured, additional context attached', item);
                return acc;
            }
            const manualOverridesFunc = manualOverrides[item.__name__];
            if (manualOverridesFunc) {
                acc[item.pod]['manualOverrides'] = {
                    ...acc[item.pod]['manualOverrides'],
                    ...manualOverridesFunc(item),
                };
            }
            return acc;
        }, {});
        const keys = Object.keys(groupedData);

        const data = keys.map((key) => {
            console.log(groupedData[key]);
            return new DiscoveryServiceEntity(groupedData[key]);
        });
        // TODO: we should be telling Influx to only give us the TOP 100 by a certain field. Instead of just sorting and tossing the rest out
        const totalUptime = data.reduce(
            (acc, { podDeletetionTime, podStartTimeInSeconds, podCompletionTimeInSeconds, metadata }) => {
                // If we have the start time for a pod use that
                if (podStartTimeInSeconds) {
                    if (podDeletetionTime) {
                        acc += parseInt(podDeletetionTime) - parseInt(podStartTimeInSeconds);
                    } else if (podCompletionTimeInSeconds) {
                        acc += parseInt(podCompletionTimeInSeconds) - parseInt(podStartTimeInSeconds);
                    }
                    //assume pod is still running
                    else {
                        acc += Date.now() / 1000 - parseInt(podStartTimeInSeconds);
                    }
                }
                return acc;
            },
            0,
        );
        if (sort) {
            const sortedList = data.sort((entityA, entityB) => entityB.cpuSeconds - entityA.cpuSeconds);
            const slicedList = sortedList.slice(offset, limit);
            // Get CPU, memory, and network data transfer for each element Joining each by their Infrastructure ID

            // Get the specific metadata for those elements
            // Build a DiscoveryServiceEntity for each element
            // Return an array of DiscoveryServiceEntity
            return { message: 'discovered services', data: slicedList, limit, totalPods: data.length, totalUptime };
        } else {
            const slicedList = data.slice(offset, limit);
            // Get CPU, memory, and network data transfer for each element Joining each by their Infrastructure ID

            // Get the specific metadata for those elements
            // Build a DiscoveryServiceEntity for each element
            // Return an array of DiscoveryServiceEntity
            return { message: 'discovered services', data: slicedList, limit, totalPods: data.length, totalUptime };
        }
    };
    public static convertCreateUsageDtoToAggregateUsageResponse(
        CreateUsageDto: CreateUsageDto[],
    ): AggregatedUsageResponse[] {
        return CreateUsageDto.map(({ dimensionId, recordValue, ...rest }) => {
            return { dimensionId, usage: [new UsageDocument({ ...rest, value: recordValue })] };
        });
    }
}

class SingleUsageEvent extends OmitType(InfluxAggregateUsageEvent, ['offeringDocument'] as const) {
    public dimension: ReadDimensionResponseData;
}
