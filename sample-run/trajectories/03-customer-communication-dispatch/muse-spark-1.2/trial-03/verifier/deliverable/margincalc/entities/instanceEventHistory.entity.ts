enum eventType {
    RunInstances = 'RunInstances',
    StartInstances = 'StartInstances',
    TerminateInstances = 'TerminateInstances',
    StopInstances = 'StopInstances',
}

class instanceChangeEvent {
    eventType: eventType;
    time: Date;
}

class Tag {
    key: string;
    value: string;
}

export class Ec2InstanceEntity {
    serviceId: string;
    eventHistory?: Array<instanceChangeEvent>;
    price: 'string';
    tagSet: Array<Tag>;
    launchTime: Date;
    constructor(eventHistory, price, tagSet, serviceId, launchTime) {
        this.eventHistory = eventHistory;
        this.price = price;
        this.tagSet = tagSet;
        this.serviceId = serviceId;
        this.launchTime = launchTime;
    }

    static determineUptime(
        eventHistory: Array<instanceChangeEvent> | undefined,
        startTime: Date,
        endTime: Date,
        ec2InstanceEntity,
    ): number {
        if (eventHistory) {
            const sortedHistory = eventHistory.sort(({ time: eventTime1 }, { time: eventTime2 }) => {
                const linuxTime1 = new Date(eventTime1).getTime();
                const linuxTime2 = new Date(eventTime2).getTime();
                return linuxTime1 - linuxTime2;
            });
            return sortedHistory.reduce(
                (total, { eventType: currentEventType, time }, currentIndex, eventHistoryArray) => {
                    if (
                        currentIndex === 0 &&
                        (currentEventType === eventType.StopInstances ||
                            currentEventType === eventType.TerminateInstances)
                    ) {
                        total += time.getTime() - startTime.getTime();
                        return total;
                    }
                    if (currentEventType === eventType.StopInstances) {
                        total += time.getTime() - eventHistoryArray[currentIndex - 1].time.getTime();
                    }
                    if (currentEventType === eventType.TerminateInstances) {
                        total += time.getTime() - eventHistoryArray[currentIndex - 1].time.getTime();
                    }
                    if (currentEventType === eventType.RunInstances && currentIndex === eventHistoryArray.length - 1) {
                        total += endTime.getTime() - time.getTime();
                    }
                    if (
                        currentEventType === eventType.StartInstances &&
                        currentIndex === eventHistoryArray.length - 1
                    ) {
                        total += endTime.getTime() - time.getTime();
                    }
                    // In milliseconds
                    return total;
                },
                0,
            );
        } else {
            if (ec2InstanceEntity.launchTime.getTime() <= startTime.getTime()) {
                return endTime.getTime() - startTime.getTime();
            } else {
                throw new Error('Invalid ec2 history');
            }
        }
    }
}
