import { EbsVolumeDataGathererEntity } from '../../microservices/ebsVolumeDataGatherer/entities/ebsVolumeDataGatherer.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class EBSStorageCostEntity extends BaseInfluxTable {
    public volumeID: EbsVolumeDataGathererEntity['volumeID'];
    public storageSize: EbsVolumeDataGathererEntity['size'];
    public iops: EbsVolumeDataGathererEntity['iops'];
    public volumeType: EbsVolumeDataGathererEntity['volumeType'];
    public throughput: EbsVolumeDataGathererEntity['throughput'];
    public businessID: EbsVolumeDataGathererEntity['businessID'];

    public declare _value: number;
}
