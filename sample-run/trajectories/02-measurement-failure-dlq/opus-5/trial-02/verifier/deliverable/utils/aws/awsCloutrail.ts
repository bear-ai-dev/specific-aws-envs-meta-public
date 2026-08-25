import { CloudTrailClient, LookupEventsCommand } from '@aws-sdk/client-cloudtrail';
import { BadRequestException } from '@nestjs/common';
import flattenDeep from 'lodash.flattendeep';

export const getInstanceInformation = async (region: string, startTime: Date, endTime: Date, creds) => {
    // Get instance start, stop and terminate times
    //eventHistory: [ {type: "start", time:"linuxtimestamp"}, {}]
    const client = new CloudTrailClient({ region, credentials: creds });

    // Right now we're just getting tag data from the "RunInstances" request params its possible that tags on an instance change overtime
    // For example tags can be removed or added after the instance is started.
    // Later on if a client wants this feature we need to add it here and additionally understand the history of the infra on a metadata level
    const commandParamArray = [
        {
            StartTime: startTime,
            EndTime: endTime,
            LookupAttributes: [{ AttributeKey: 'EventName', AttributeValue: 'RunInstances' }],
        },
        {
            StartTime: startTime,
            EndTime: endTime,
            LookupAttributes: [{ AttributeKey: 'EventName', AttributeValue: 'StartInstances' }],
        },
        {
            StartTime: startTime,
            EndTime: endTime,
            LookupAttributes: [{ AttributeKey: 'EventName', AttributeValue: 'StopInstances' }],
        },
        {
            StartTime: startTime,
            EndTime: endTime,
            LookupAttributes: [{ AttributeKey: 'EventName', AttributeValue: 'TerminateInstances' }],
        },
    ];

    const eventHistory = await Promise.all(
        commandParamArray.map(async (command) => {
            try {
                return clientPaginationLoop(client, command);
            } catch (error) {
                console.log('Error', error);
                if (error.Code === 'AccessDenied') throw new BadRequestException('Invalid IAM role or external ID');
                else throw error;
            }
        }),
    );
    // Sort the array with smallest time first.
    const flatArray = flattenDeep(eventHistory);
    const instanceEventHistory = flatArray.reduce((acc, { EventName, CloudTrailEvent }) => {
        try {
            const { errorCode, responseElements, eventTime } = JSON.parse(CloudTrailEvent);
            if (errorCode) {
                return acc;
            }
            // We destructure after the errorcode check because responseElements is null in error event cases which are not currently filtered out of the request
            const { instancesSet } = responseElements;
            if (EventName === 'RunInstances') {
                instancesSet.items.forEach(({ instanceId, tagSet, launchTime, instanceType }) => {
                    // TODO: Tagset is really not being tracked for changes,
                    // we assume the tags put on during the runInstance is what the tags are for the lifetime of the instance.
                    // This is not always the case.
                    // Fix this

                    if (!acc[instanceId]) {
                        acc[instanceId] = {
                            ...acc[instanceId],
                            tagSet,
                            eventHistory: [{ eventType: EventName, time: new Date(eventTime) }],
                            launchTime: new Date(launchTime),
                            InstanceType: instanceType,
                        };
                    } else {
                        acc[instanceId]['eventHistory'].push({
                            eventType: EventName,
                            time: new Date(eventTime),
                        });
                        acc[instanceId]['tagSet'] = tagSet;
                        acc[instanceId]['launchTime'] = new Date(launchTime);
                        acc[instanceId]['InstanceType'] = instanceType;
                    }
                });
            }
            if (EventName === 'StartInstances') {
                instancesSet.items.forEach(({ instanceId }) => {
                    if (!acc[instanceId]) {
                        acc[instanceId] = {
                            ...acc[instanceId],
                            eventHistory: [{ eventType: EventName, time: new Date(eventTime) }],
                        };
                    } else {
                        acc[instanceId]['eventHistory'].push({
                            eventType: EventName,
                            time: new Date(eventTime),
                        });
                    }
                });
            }
            if (EventName === 'StopInstances') {
                instancesSet.items.forEach(({ instanceId }) => {
                    if (!acc[instanceId]) {
                        acc[instanceId] = {
                            ...acc[instanceId],
                            eventHistory: [{ eventType: EventName, time: new Date(eventTime) }],
                        };
                    } else {
                        acc[instanceId]['eventHistory'].push({
                            eventType: EventName,
                            time: new Date(eventTime),
                        });
                    }
                });
            }
            if (EventName === 'TerminateInstances') {
                instancesSet.items.forEach(({ instanceId }) => {
                    if (!acc[instanceId]) {
                        acc[instanceId] = {
                            ...acc[instanceId],
                            eventHistory: [{ eventType: EventName, time: new Date(eventTime) }],
                        };
                    } else {
                        acc[instanceId]['eventHistory'].push({
                            eventType: EventName,
                            time: new Date(eventTime),
                        });
                    }
                });
            }
            return acc;
        } catch (error) {
            console.log('ERROR BLOCK', CloudTrailEvent);
            throw error;
        }
    }, {});
    // We now need to determine what events are missing tag information
    await Promise.all(
        Object.keys(instanceEventHistory).map(async (element) => {
            if (!instanceEventHistory[element].tagSet) {
                const param = {
                    LookupAttributes: [{ AttributeKey: 'ResourceName', AttributeValue: element }],
                };
                const [results] = await clientPaginationLoop(client, param);
                results.forEach(({ EventName, CloudTrailEvent }) => {
                    if (EventName === 'RunInstances') {
                        const {
                            responseElements: { instancesSet },
                        } = JSON.parse(CloudTrailEvent);
                        const { tagSet, instanceType, launchTime } = instancesSet.items.find(
                            ({ instanceId }) => instanceId == element,
                        );
                        instanceEventHistory[element]['tagSet'] = tagSet;

                        instanceEventHistory[element]['InstanceType'] = instanceType;
                        instanceEventHistory[element]['launchTime'] = new Date(launchTime);
                    }
                });
            }
        }),
    );
    return instanceEventHistory;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clientPaginationLoop = async (client: CloudTrailClient, params) => {
    let next;
    let retryLoop;
    let retryCounter = 0;
    const MAX_ATTEMPTS = 5;
    const results = [];
    do {
        retryLoop = false;
        const command = new LookupEventsCommand({ NextToken: next, ...params });
        try {
            const { NextToken, Events } = await client.send(command);
            results.push(Events);
            next = NextToken;
            retryCounter = 0;
        } catch (error) {
            if (retryCounter >= MAX_ATTEMPTS) {
                console.log(`Retry exceeded max threshold ${MAX_ATTEMPTS}, ${retryCounter}`);
                throw error;
            }
            if (error?.__type === 'ThrottlingException') {
                retryLoop = true;

                retryCounter++;

                await sleep(200 * Math.random() * retryCounter); // geometric backoff with jitter, exponential is for nerds
            } else {
                throw error;
            }
        }
    } while (next || retryLoop);
    return results;
};
