import { Tag } from '@aws-sdk/client-ec2';
import { Point } from '@influxdata/influxdb-client';
import { Logger } from '@nestjs/common';
import { InfluxService } from '../../../influx/influx.service.js';

export class EbsSnapshotDataGathererEntity {
    private static readonly logger = new Logger(EbsSnapshotDataGathererEntity.name);

    public static _measurement = 'ebsSnapshot';
    public static tagSeparator = 'tag_';
    public volumeID: string;
    public storageTier: string;
    public businessID: string;
    public size: number;
    public snapshotId: string;
    public snapshotOwnerID: string;
    public tags: Array<Tag>;
    public snapshotStartTime: Date;

    constructor({
        volumeID,
        businessID,
        storageTier,
        size,
        snapshotId,
        tags,
        snapshotStartTime,
        snapshotOwnerID,
    }: EbsSnapshotDataGathererEntity) {
        this.volumeID = volumeID;
        this.businessID = businessID;
        this.snapshotId = snapshotId;
        this.size = size;
        this.tags = tags;
        this.storageTier = storageTier;
        this.snapshotStartTime = snapshotStartTime;
        this.snapshotOwnerID = snapshotOwnerID;
    }
    static transformer(
        ebsSnapshotDataGathererEntity: EbsSnapshotDataGathererEntity,
        influxService: InfluxService,
    ): Point {
        const {
            volumeID,
            businessID,
            size,
            storageTier,
            snapshotId,
            tags = [],
            snapshotStartTime,
            snapshotOwnerID,
        } = ebsSnapshotDataGathererEntity;
        const volumeEntityPoint = influxService.getPoint(EbsSnapshotDataGathererEntity._measurement);

        volumeEntityPoint.tag('volumeID', volumeID);
        volumeEntityPoint.tag('businessID', businessID);
        volumeEntityPoint.tag('storageTier', storageTier);
        volumeEntityPoint.tag('snapshotId', snapshotId);
        volumeEntityPoint.tag('snapshotOwnerID', snapshotOwnerID);
        volumeEntityPoint.tag('snapshotStartTime', snapshotStartTime.toISOString());
        tags.forEach(({ Key, Value }) => {
            volumeEntityPoint.tag(`${EbsSnapshotDataGathererEntity.tagSeparator}${Key}`, Value.toString());
        });

        volumeEntityPoint.intField('size', size);

        return volumeEntityPoint;
    }

    static dbModelToEntity(dbModel: any): EbsSnapshotDataGathererEntity {
        const { volumeID, businessID, _value, storageTier, snapshotId, snapshotStartTime, snapshotOwnerID, ...rest } =
            dbModel;
        const regex = new RegExp(`^${EbsSnapshotDataGathererEntity.tagSeparator}`);
        const tags = Object.keys(rest)
            .filter((key) => regex.test(key))
            .map((key) => {
                const [notNeeded, ...noTagPrefix] = key.split(EbsSnapshotDataGathererEntity.tagSeparator);
                const joined = noTagPrefix.join('');

                return { Key: joined, Value: rest[key] };
            });

        return new EbsSnapshotDataGathererEntity({
            volumeID,
            businessID,
            size: _value,
            storageTier,
            snapshotId,
            tags,
            snapshotStartTime,
            snapshotOwnerID,
        });
    }
}
