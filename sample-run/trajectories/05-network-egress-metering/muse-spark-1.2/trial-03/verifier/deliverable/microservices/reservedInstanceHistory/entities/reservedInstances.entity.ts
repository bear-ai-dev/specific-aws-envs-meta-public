import { Point } from '@influxdata/influxdb-client';
import { Logger } from '@nestjs/common';
import { InfluxService } from '../../../influx/influx.service.js';

export class ReservedInstanceEntity {
    private static readonly logger = new Logger(ReservedInstanceEntity.name);

    public static _measurement = 'ReservedInstanceData';

    public instanceType: string;
    public instanceCount: string;
    public instanceTenancy: string;
    public fixedPrice: string;
    public endDate: string;
    public startDate: string;
    public availabilityZone: string;
    public recurringCharges: string;
    public reservedInstancesId: string;
    public businessID: string;
    public OfferingType: string;

    constructor({
        instanceType,
        instanceCount,
        instanceTenancy,
        fixedPrice,
        endDate,
        startDate,
        availabilityZone,
        recurringCharges,
        reservedInstancesId,
        businessID,
        OfferingType,
    }: ReservedInstanceEntity) {
        this.instanceType = instanceType;
        this.instanceCount = instanceCount;
        this.instanceTenancy = instanceTenancy;
        this.fixedPrice = fixedPrice;
        this.endDate = endDate;
        this.availabilityZone = availabilityZone;
        this.recurringCharges = recurringCharges;
        this.reservedInstancesId = reservedInstancesId;
        this.businessID = businessID;
        this.OfferingType = OfferingType;
        this.startDate = startDate;
    }

    public static transformer(instanceUptimeEntity: ReservedInstanceEntity, influxService: InfluxService): Point {
        const {
            instanceType,
            instanceCount,
            instanceTenancy,
            fixedPrice,
            endDate,
            availabilityZone,
            recurringCharges,
            reservedInstancesId,
            OfferingType,
            startDate,
        } = instanceUptimeEntity;

        const reservedInstanceEntityPoint = influxService.getPoint(ReservedInstanceEntity._measurement);
        reservedInstanceEntityPoint.tag('instanceType', instanceType);
        reservedInstanceEntityPoint.stringField('instanceCount', instanceCount);
        reservedInstanceEntityPoint.tag('instanceTenancy', instanceTenancy);
        reservedInstanceEntityPoint.tag('fixedPrice', fixedPrice);
        reservedInstanceEntityPoint.tag('endDate', endDate);
        reservedInstanceEntityPoint.tag('startDate', startDate);
        reservedInstanceEntityPoint.tag('availabilityZone', availabilityZone);
        reservedInstanceEntityPoint.tag('recurringCharges', recurringCharges);
        reservedInstanceEntityPoint.tag('reservedInstancesId', reservedInstancesId);
        reservedInstanceEntityPoint.tag('OfferingType', OfferingType);
        reservedInstanceEntityPoint.tag('businessID', instanceUptimeEntity.businessID);

        return reservedInstanceEntityPoint;
    }
    public static dbModelToEntity(dbModel: any): ReservedInstanceEntity {
        const {
            instanceType,
            _value,
            instanceTenancy,
            fixedPrice,
            endDate,
            availabilityZone,
            recurringCharges,
            reservedInstancesId,
            businessID,
            OfferingType,
            startDate,
        } = dbModel;

        return new ReservedInstanceEntity({
            instanceType,
            instanceCount: _value,
            instanceTenancy,
            fixedPrice,
            endDate,
            startDate,
            availabilityZone,
            recurringCharges,
            reservedInstancesId,
            businessID,
            OfferingType,
        });
    }
}
