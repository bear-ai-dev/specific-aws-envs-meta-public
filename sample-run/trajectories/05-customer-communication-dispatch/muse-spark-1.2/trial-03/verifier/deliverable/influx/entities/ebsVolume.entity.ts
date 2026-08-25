import { EbsVolumeDataGathererEntity } from '../../microservices/ebsVolumeDataGatherer/entities/ebsVolumeDataGatherer.entity.js';
import { EbsSnapshotDataGathererEntity } from '../../microservices/ebsSnapshotDataGatherer/entities/ebsSnapshotDataGatherer.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class EBSVolumeProvisionedCapacity extends BaseInfluxTable {
    public volumeID: EbsVolumeDataGathererEntity['volumeID'];
    public size: EbsVolumeDataGathererEntity['size'];
    public iops: EbsVolumeDataGathererEntity['iops'];
    public volumeType: EbsVolumeDataGathererEntity['volumeType'];
    public tags: EbsVolumeDataGathererEntity['tags'];
    public state: EbsVolumeDataGathererEntity['state'];
    public throughput: EbsVolumeDataGathererEntity['throughput'];
    public availabilityZone: EbsVolumeDataGathererEntity['availabilityZone'];
    public businessID: EbsVolumeDataGathererEntity['businessID'];
    public region: EbsVolumeDataGathererEntity['region'];

    public declare _value: number;
}

export class EBSSnapshot extends BaseInfluxTable {
    public volumeID: EbsSnapshotDataGathererEntity['volumeID'];
    public businessID: EbsSnapshotDataGathererEntity['businessID'];
    public declare _field: EbsSnapshotDataGathererEntity['size'];
    public snapshotOwnerID: EbsSnapshotDataGathererEntity['snapshotOwnerID'];
    public snapshotStartTime: EbsSnapshotDataGathererEntity['snapshotStartTime'];
    public storageTier: EbsSnapshotDataGathererEntity['storageTier'];
    public snapshotId: EbsSnapshotDataGathererEntity['snapshotId'];

    public declare _value: number;
}
