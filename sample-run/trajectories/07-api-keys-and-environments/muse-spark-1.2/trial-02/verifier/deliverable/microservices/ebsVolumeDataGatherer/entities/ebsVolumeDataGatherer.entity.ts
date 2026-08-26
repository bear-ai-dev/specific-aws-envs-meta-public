import { Tag } from '@aws-sdk/client-ec2';
import { Point } from '@influxdata/influxdb-client';
import { Logger } from '@nestjs/common';
import { EBSVolumeProvisionedCapacity } from '../../../influx/entities/ebsVolume.entity.js';
import { InfluxService } from '../../../influx/influx.service.js';

export class EbsVolumeDataGathererEntity {
    private static readonly logger = new Logger(EbsVolumeDataGathererEntity.name);

    public static _measurement = 'ebsVolume';
    public volumeID: string;
    public businessID: string;
    public size: number;
    public iops: number;
    public volumeType: string;
    public tags: Array<Tag>;
    public state: string;
    public throughput: number;
    public availabilityZone: string;
    public region: string;
    private static tagSeparator = 'tag_';

    constructor({
        volumeID,
        businessID,
        size,
        iops,
        volumeType,
        tags,
        state,
        throughput,
        availabilityZone,
        region,
    }: EbsVolumeDataGathererEntity) {
        this.volumeID = volumeID;
        this.businessID = businessID;
        this.size = size;
        this.iops = iops;
        this.volumeType = volumeType;
        this.tags = tags;
        this.state = state;
        this.throughput = throughput;
        this.availabilityZone = availabilityZone;
        this.region = region;
    }
    static transformer(ebsVolumeEntity: EbsVolumeDataGathererEntity, influxService: InfluxService): Point {
        const {
            volumeID,
            businessID,
            size,
            iops,
            volumeType,
            tags = [],
            state,
            throughput,
            availabilityZone,
            region,
        } = ebsVolumeEntity;
        const volumeEntityPoint = influxService.getPoint(EbsVolumeDataGathererEntity._measurement);

        volumeEntityPoint.tag('volumeID', volumeID);
        volumeEntityPoint.tag('businessID', businessID);
        volumeEntityPoint.tag('volumeType', volumeType);
        tags.forEach(({ Key, Value }) => {
            volumeEntityPoint.tag(`${EbsVolumeDataGathererEntity.tagSeparator}${Key}`, Value.toString());
        });
        volumeEntityPoint.tag('iops', iops.toString());
        if (throughput) {
            volumeEntityPoint.tag('throughput', throughput.toString());
        }
        volumeEntityPoint.tag('availabilityZone', availabilityZone);
        volumeEntityPoint.tag('region', region);

        volumeEntityPoint.tag('state', state);

        volumeEntityPoint.intField('size', size);

        return volumeEntityPoint;
    }

    static dbModelToEntity(dbModel: EBSVolumeProvisionedCapacity): EbsVolumeDataGathererEntity {
        const { volumeID, businessID, _value, iops, volumeType, state, throughput, availabilityZone, region, ...rest } =
            dbModel;
        const regex = new RegExp(`^${EbsVolumeDataGathererEntity.tagSeparator}`);
        const tags = Object.keys(rest)
            .filter((key) => regex.test(key))
            .map((key) => {
                const [notNeeded, ...noTagPrefix] = key.split(EbsVolumeDataGathererEntity.tagSeparator);
                const joined = noTagPrefix.join('');

                return { Key: joined, Value: rest[key] };
            });

        return new EbsVolumeDataGathererEntity({
            volumeID,
            businessID,
            size: _value,
            iops,
            volumeType,
            tags,
            state,
            throughput,
            availabilityZone,
            region,
        });
    }
}
