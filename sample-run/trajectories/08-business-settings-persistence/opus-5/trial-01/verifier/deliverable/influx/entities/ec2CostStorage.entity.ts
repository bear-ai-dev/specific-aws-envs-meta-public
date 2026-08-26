import { EbsVolumeDataGathererEntity } from '../../microservices/ebsVolumeDataGatherer/entities/ebsVolumeDataGatherer.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class EC2CostInfluxRow extends BaseInfluxTable {
    public declare _value: number;
    public unitCost: number;
    public cpu: number;
    public ram: number;
    public podId: string;
    public meteringcoId: string;
    public businessID: string;
    public timeDelta: number;
}
