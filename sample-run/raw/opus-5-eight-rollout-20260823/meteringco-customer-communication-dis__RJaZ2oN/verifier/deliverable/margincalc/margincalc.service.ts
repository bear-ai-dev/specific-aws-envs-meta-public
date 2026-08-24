import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AwsServices, CreateMargincalcDto } from './dto/createMarginCalc.dto.js';
import { getAllInstanceIDs } from '../utils/aws/awsEc2.js';
import { getRegionNameFromCode } from '../utils/aws/awsSSM.js';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import fetch from 'cross-fetch';
import flattenDeep from 'lodash.flattendeep';
import { getInstanceInformation } from '../utils/aws/awsCloutrail.js';
import { Ec2InstanceEntity } from './entities/instanceEventHistory.entity.js';
import { GetCostDto } from './dto/getCost.dto.js';
import { DiscoveryServiceEntity } from '../influx/entities/discovery.entity.js';

const millisecondsToHours = (timeInMS) => timeInMS / 1000 / 60 / 60;
const secondsToHours = (timeInSeconds) => timeInSeconds / 60 / 60;

@Injectable()
export class MargincalcService {
    private static readonly logger = new Logger(MargincalcService.name);
    /**
     * This Function takes in a list of services, to query for
     * queries Cloudwatch for their start time
     * assum
     *
     */
    async create({
        iamRole,
        margin,
        serviceList,
        region,
        startTime,
        endTime,
        externalID,
        tagList,
        setPrice,
    }: CreateMargincalcDto): Promise<
        [
            {
                operationalHours: number;
                totalCost: number;
                unitCost: number;
                id: string;
                total: number;
                startDate: Date;
                endDate: Date;
            },
        ]
    > {
        const regionName = await getRegionNameFromCode(region);
        const [{ resourceInfo }] = await Promise.all(
            serviceList.map((awsService) =>
                MargincalcService.awsServiceHandler(
                    awsService,
                    iamRole,
                    startTime,
                    endTime,
                    regionName,
                    externalID,
                    region,
                    tagList,
                ),
            ),
        );
        const responseData = await Promise.all(
            MargincalcService.calculateUsage(resourceInfo, new Date(startTime), new Date(endTime), margin, setPrice),
        );

        const flatResponse = flattenDeep(responseData);
        return flatResponse.filter((element) => element);
    }
    async calculateCost({ data }: GetCostDto) {
        // Loop over all discovered service entities

        const results = await Promise.all(
            data.map(
                async ({ cpuSeconds, infrastructureType, region, hostOperatingSystem, ID }: DiscoveryServiceEntity) => {
                    // Take in the usage data plus instance information
                    if (!infrastructureType || !region || !hostOperatingSystem) {
                        MargincalcService.logger.warn(`Failed to get Cost information for infra: ${ID}`);
                        return {
                            message: `Unable to get cost information for the following component: ${ID}`,

                            context: { infrastructureType, region, hostOperatingSystem },
                        };
                    }

                    const regionName = await getRegionNameFromCode(region);
                    // get the cost for each instance
                    const price = await MargincalcService.getCost(AwsServices.EC2, {
                        region: regionName,
                        PlatformDetails: hostOperatingSystem,
                        InstanceType: infrastructureType,
                        id: ID,
                    });
                    // multiply cost x time
                    const unitCost = parseFloat(price);
                    const totalCost = unitCost * secondsToHours(cpuSeconds);

                    // return unit costs and totals
                    return {
                        unitCost,
                        totalCost,
                        usageTimeInHours: secondsToHours(cpuSeconds),
                        ID,
                    };
                },
            ),
        );
        return results;
    }
    static calculateUsage(elements: Array<Ec2InstanceEntity>, startTime, endTime, margin, setPrice) {
        return elements.map((entity) => {
            const timeInHoursInstanceWasUp = millisecondsToHours(
                Ec2InstanceEntity.determineUptime(entity.eventHistory, startTime, endTime, entity),
            );
            const cost = parseFloat(entity.price) * timeInHoursInstanceWasUp;
            let dueAmount;
            if (margin) {
                dueAmount = cost * parseFloat(margin) + cost;
            } else if (setPrice) {
                dueAmount = setPrice * timeInHoursInstanceWasUp;
            }
            return {
                operationalHours: timeInHoursInstanceWasUp,
                totalCost: cost,
                unitCost: parseFloat(entity.price),
                id: entity.serviceId,
                total: dueAmount,
                startDate: startTime.toISOString().split('T')[0],
                endDate: endTime.toISOString().split('T')[0],
            };
        });
    }

    static async getCost(
        awsService: AwsServices,
        resourceInfo: { InstanceType: string; PlatformDetails: string; region: string; id: string },
    ) {
        if (awsService === 'EC2') {
            const { InstanceType, PlatformDetails, region, id } = resourceInfo;
            if (!InstanceType) {
                return { message: `Unable to find cost information for ${id}` };
            }
            const platformLookup = {
                'Linux/UNIX': 'Linux',
                'Red Hat Enterprise Linux': 'RHEL',
                Windows: 'Windows',
                'SUSE Linux': 'SUSE',
            }; // TODO add more of these
            let serverType = platformLookup[PlatformDetails];
            if (!serverType) {
                // Defaulting makes sense since PlatformDetails are optional from the AWS API which is needed for the cost request
                // we just need to let users know, this could even be parameterizeable based on user preferences
                console.log('Defaulting Server Type');
                serverType = platformLookup['Linux/UNIX'];
            }

            const response = await fetch(
                `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/ec2-ondemand-without-sec-sel/${encodeURIComponent(
                    region,
                )}/${serverType}/index.json`,
                {
                    credentials: 'omit',
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:100.0) Gecko/20100101 Firefox/100.0',
                        Accept: '*/*',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Sec-Fetch-Dest': 'empty',
                        'Sec-Fetch-Mode': 'cors',
                        'Sec-Fetch-Site': 'same-site',
                    },
                    referrer: 'https://c0.b0.p.awsstatic.com/',
                    method: 'GET',
                    mode: 'cors',
                },
            );
            const jsonResponse = await response.json();
            const res =
                jsonResponse?.regions[region][
                    `${InstanceType.split('.').join(' ')} ${region} ${serverType}`.replace(/[()]/g, '')
                ];
            if (res) {
                const { price } = res;
                return price;
            } else {
                const response = await fetch(
                    `https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/previousgen-ondemand/${encodeURIComponent(
                        region,
                    )}/${serverType}/index.json`,
                    {
                        credentials: 'omit',
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:100.0) Gecko/20100101 Firefox/100.0',
                            Accept: '*/*',
                            'Accept-Language': 'en-US,en;q=0.5',
                            'Sec-Fetch-Dest': 'empty',
                            'Sec-Fetch-Mode': 'cors',
                            'Sec-Fetch-Site': 'same-site',
                        },
                        referrer: 'https://c0.b0.p.awsstatic.com/',
                        method: 'GET',
                        mode: 'cors',
                    },
                );
                const jsonResponse = await response.json();
                console.log('memes');
                const [id] = Object.keys(jsonResponse?.regions[region]).filter((key) =>
                    key.includes(`${InstanceType.split('.').join(' ')} ${region} ${serverType}`.replace(/[()]/g, '')),
                );
                const { price } = jsonResponse?.regions[region][id];
                return price;
            }
        }
    }
    static async awsServiceHandler(awsService, iamRole, startTime, endTime, regionName, ExternalId, region, tagList) {
        const creds = fromTemporaryCredentials({ params: { RoleArn: iamRole, ExternalId } });
        if (awsService === AwsServices.EC2) {
            // Find all instances of Ec2 which were active in a given time period in an AWS region.

            // Valid Billable Cases:
            // Created before time period
            // Created during time period
            // Created and terminated within time period but longer than 1 hour ago
            // Created and terminated within time period but within an hour
            // Created before time period, terminated within time period but longer than 1 hour ago
            // Created before time period, terminated within time period but within an hour ago
            // Created and stopped within time period
            // Created, stopped, and started within time period (stop start cycle can be numerous occurances)
            // Created, stopped, and termineted within the time period but longer than 1 hour ago
            // Created, stopped, and termineted within the time period but within than 1 hour ago
            // Created, stopped, started, and terminated within time period but longer than 1 hour ago (stop start cycle can be numerous occurances)
            // Created, stopped, started, and terminated within time period but within than 1 hour ago (stop start cycle can be numerous occurances)

            // Known limitations and issues with AWS APIs
            // Run instances from Cloudtrail is the only event which has tag information, not present on Terminated, stopped, and started
            // Terminated instances are only avaiable within 1 hour oftermination to the describeInstances API

            // Three broad concepts
            // 1. Getting tag data for an instance
            // 2. Getting the instance uptime
            // 3. Getting cost data for the instances

            // General Alogrithm for Instance Uptime calculation

            // Get all instances events from cloudtrail, Instance data for currently running instances and instances outside the end date time range specified
            // Filter out invalid instances, ex: instances without the right tags, instances who are in the describe instance API call but were started after the end time
            // For each valid instance get its cost data
            // Return an Array of ec2InstanceEntity Object with the correct information filled it

            // Get all instance IDs, and instance type
            try {
                const [instanceArray, instanceHistories, filterableInstances] = await Promise.all([
                    getAllInstanceIDs(region, creds, tagList),
                    getInstanceInformation(region, new Date(startTime), new Date(endTime), creds),
                    getInstanceInformation(region, new Date(endTime), new Date(), creds),
                ]);

                // Remove running instances which were started after the endtime of the query
                const ignoreableIds = Object.keys(filterableInstances).filter((id) => {
                    const history = filterableInstances[id].eventHistory;

                    return (
                        history[history.length - 1].eventType === 'StartInstances' ||
                        history[history.length - 1].eventType === 'RunInstances'
                    );
                });

                const filteredInstanceArray = instanceArray.filter(
                    (element) => element && !ignoreableIds.includes(element.InstanceId),
                );
                // combine results
                const combinedInstances = filteredInstanceArray.reduce((acc, { InstanceId, ...rest }) => {
                    acc[InstanceId] = { ...rest, ...acc[InstanceId] };
                    return acc;
                }, instanceHistories);

                let validInstanceHistories = {};
                if (tagList && tagList.length) {
                    const validIds = Object.keys(combinedInstances).filter((id) => {
                        const tags = combinedInstances[id].tagSet;
                        if (tags) {
                            console.log(Object.keys(tags), 'Tags');
                            const res = tagList?.find(({ Name, Values }) => {
                                if (Array.isArray(tags)) {
                                    console.log(tags, 'array tags');
                                    return tags.find(({ Key: key, Value: value }) => {
                                        return key === Name.split(':')[1] && Values.includes(value);
                                    });
                                } else {
                                    return tags?.items?.find(({ key, value }) => {
                                        return key === Name.split(':')[1] && Values.includes(value);
                                    });
                                }
                            });
                            return res;
                        } else {
                            return false;
                        }
                    });
                    validInstanceHistories = validIds.reduce((acc, id) => {
                        acc[id] = instanceHistories[id];
                        return acc;
                    }, {});
                } else {
                    validInstanceHistories = instanceHistories;
                }
                console.log(JSON.stringify(validInstanceHistories));
                const entities = await Promise.all(
                    Object.keys(validInstanceHistories).map(async (instanceId) => {
                        const { eventHistory, tagSet, launchTime, PlatformDetails, InstanceType } =
                            validInstanceHistories[instanceId];
                        const price = await MargincalcService.getCost(AwsServices.EC2, {
                            PlatformDetails,
                            region: regionName,
                            InstanceType,
                            id: instanceId,
                        });

                        // TODO:  determine serviceId from tags, and potentially other sources as well
                        return new Ec2InstanceEntity(eventHistory, price, tagSet, instanceId, launchTime);
                    }),
                );

                return { resourceInfo: entities, awsService };
            } catch (error) {
                if (error.Code === 'AccessDenied') throw new BadRequestException('Invalid IAM role or external ID');
                else {
                    throw error;
                }
            }
        }
    }
}
