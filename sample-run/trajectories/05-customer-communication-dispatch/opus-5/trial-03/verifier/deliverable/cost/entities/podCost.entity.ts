import { Logger } from '@nestjs/common';
import { InfluxService } from '../../influx/influx.service.js';
import { SchedulerStatus, schedulerType, SupportedMeasurementFrequencies } from '../../scheduler/dto/scheduler.dto.js';
import { SchedulerService } from '../../scheduler/scheduler.service.js';
import { ComputeCostSource } from '../../setting/dto/update-settings.dto.js';

export class PodCostEntity {
    // Create defintions for the labels in the constructor of this class
    public static _measurement = 'ec2Cost';
    public static _schedulerKey = 'getAndCommitPODCost';

    public hourlyComputeCost: number;
    public cpu: number;
    public ram: number;
    public podId: string;
    public customerId: string;
    public businessID: string;
    public timeDelta: number;
    public instanceId: string;
    public instanceStatus: string;

    constructor({
        hourlyComputeCost,
        cpu,
        ram,
        podId,
        customerId,
        timeDelta,
        businessID,
        instanceId,
        instanceStatus,
    }: PodCostEntity) {
        this.hourlyComputeCost = hourlyComputeCost;
        this.cpu = cpu;
        this.ram = ram;
        this.podId = podId;
        this.customerId = customerId;
        this.timeDelta = timeDelta;
        this.businessID = businessID;
        this.instanceId = instanceId;
        this.instanceStatus = instanceStatus;
    }
    private static readonly logger = new Logger(PodCostEntity.name);
    public static determineUnitPrice({
        instanceType,
        priceDocument,
        isReserved,
        ReservedInstanceEntity,
    }: {
        instanceType: string;
        priceDocument: OnDemandInstanceEntity;
        isReserved: boolean;
        ReservedInstanceEntity: any;
    }) {
        if (!isReserved) {
            return priceDocument.pricePerUnit;
        } else {
            if (ReservedInstanceEntity?.recurringCharges) {
                const { recurringCharges } = ReservedInstanceEntity;
                const [{ Amount }] = JSON.parse(recurringCharges);
                return Amount;
            } else {
                return priceDocument.pricePerUnit;
            }
        }
    }
    public static calculateCost({ unitPrice, timeDelta, podCountPerNode }) {
        PodCostEntity.logger.log(
            `Logging inputs for calculate cost${JSON.stringify({ unitPrice, timeDelta, podCountPerNode })}`,
        );
        if (unitPrice) {
            return (unitPrice * timeDelta) / podCountPerNode;
        } else {
            return 0;
        }
    }

    public static transformer(eC2CostEntity: PodCostEntity, influxService: InfluxService) {
        const { getPoint } = influxService;
        const { businessID, hourlyComputeCost, cpu, ram, podId, customerId, timeDelta } = eC2CostEntity;
        const point = getPoint(PodCostEntity._measurement);
        point.tag('businessID', businessID);
        point.tag('cpu', cpu.toString());
        point.tag('ram', ram.toString());
        point.tag('podId', podId);
        point.tag('customerId', customerId);
        point.tag('timeDelta', timeDelta.toString());
        point.tag('instanceId', eC2CostEntity.instanceId);
        point.tag('instanceStatus', eC2CostEntity.instanceStatus);

        point.floatField('hourlyComputeCost', hourlyComputeCost);

        return point;
    }

    public static dbModelToEntity(dbModel: any) {
        const { businessID, _value, cpu, ram, podId, customerId, timeDelta, instanceId, instanceStatus } = dbModel;
        return new PodCostEntity({
            businessID,
            hourlyComputeCost: _value,
            cpu,
            ram,
            podId,
            customerId,
            timeDelta,
            instanceId,
            instanceStatus,
        });
    }

    public static averageCostsConverterToDto(dbModel) {
        const { _value, cpu, ram } = dbModel;
        return {
            cpu: cpu.toString(),
            ram: ram.toString(),
            averageUnitCost: _value.toString(),
        };
    }
    public static async enroll(
        schedulerService: SchedulerService,
        { businessID, subject }: { businessID: string; subject: string },
    ): Promise<void> {
        await schedulerService.create({
            businessID,
            schedulerID: PodCostEntity.createScheduleID({ businessID }),
            schedulerStatus: SchedulerStatus.live,
            subject,
            rate: SupportedMeasurementFrequencies.everyHour,
            schedulerType: schedulerType.cost,
            scheduleParameters: { costType: ComputeCostSource.eks },
        });
    }
    public static async unenroll(
        schedulerService: SchedulerService,
        { businessID }: { businessID: string; subject: string },
    ): Promise<void> {
        await schedulerService.remove({ businessID, schedulerID: PodCostEntity.createScheduleID({ businessID }) });
    }
    public static createScheduleID({ businessID }) {
        return `${businessID}-${PodCostEntity._schedulerKey}`;
    }
}

export class OnDemandInstanceEntity {
    public unit: string;
    public pricePerUnit: string;

    constructor({ unit, pricePerUnit }) {
        this.unit = unit;
        this.pricePerUnit = pricePerUnit;
    }
}
