import { Point } from '@influxdata/influxdb-client';
import { Logger } from '@nestjs/common';
import { InfluxService } from '../../../influx/influx.service.js';

export class InstanceUptimeEntity {
    private static readonly logger = new Logger(InstanceUptimeEntity.name);

    public static _measurement = 'InstanceMetaData';
    public instanceID: string;
    public status: string;
    public metadata: any;
    public startTime: string;
    public businessID: string;
    public ram: string;
    public cpu: string;
    public privateDNS: string;
    public instanceType: string;
    public region: string;

    constructor({
        instanceID,
        status: { Name },
        metadata,
        startTime,
        businessID,
        memory,
        cpuCores,
        privateDNS,
        instanceType,
        region,
    }) {
        this.instanceID = instanceID;
        this.status = Name;
        this.metadata = metadata;
        this.startTime = startTime;
        this.businessID = businessID;
        this.ram = memory;
        this.cpu = cpuCores;
        this.privateDNS = privateDNS;
        this.instanceType = instanceType;
        this.region = region;
    }
    public static async transformer(
        instanceUptimeEntity: InstanceUptimeEntity,
        influxService: InfluxService,
    ): Promise<Point | false> {
        const { instanceID, status, metadata, startTime, businessID } = instanceUptimeEntity;

        const uptimeEntityPoint = influxService.getPoint(InstanceUptimeEntity._measurement);
        const startTimeDate = new Date(startTime);
        uptimeEntityPoint.tag('instanceID', instanceID);
        uptimeEntityPoint.tag('instanceType', instanceUptimeEntity.instanceType);
        uptimeEntityPoint.tag('cpuCores', instanceUptimeEntity.cpu);
        uptimeEntityPoint.tag('memory', instanceUptimeEntity.ram);
        uptimeEntityPoint.tag('privateDNS', instanceUptimeEntity.privateDNS);

        uptimeEntityPoint.stringField('status', status);
        uptimeEntityPoint.tag('businessID', businessID);
        uptimeEntityPoint.tag('startTime', startTimeDate.getTime().toString());
        uptimeEntityPoint.tag('region', instanceUptimeEntity.region);
        if (metadata) {
            metadata.forEach(({ Key, Value }) => {
                uptimeEntityPoint.tag(`meteringcometadata_${Key}`, Value.toString());
            });
        }

        return uptimeEntityPoint;
    }
    public static dbModelToEntity(dbModel: any): InstanceUptimeEntity {
        const {
            instanceID,
            _value,
            startTime,
            businessID,
            memory,
            cpuCores,
            privateDNS,
            instanceType,
            region,
            ...rest
        } = dbModel;
        const metadata = Object.keys(rest)
            .filter((key) => /meteringcometadata_/.test(key))
            .reduce((acc, key) => {
                acc[key] = rest[key];
                return acc;
            }, {});
        console.log('instanceUptime Region', region);
        return new InstanceUptimeEntity({
            instanceID,
            status: { Name: _value },
            metadata,
            startTime,
            businessID,
            memory,
            cpuCores,
            privateDNS,
            instanceType,
            region,
        });
    }
}
