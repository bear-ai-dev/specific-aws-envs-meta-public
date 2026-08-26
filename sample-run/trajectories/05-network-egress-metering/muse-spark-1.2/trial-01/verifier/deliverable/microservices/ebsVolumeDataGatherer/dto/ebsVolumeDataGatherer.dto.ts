import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';
import {
    IAMAccessCredentials,
    InfrastructureAccessInformation,
} from '../../../measurement-config/entities/measurement-config.entity.js';

export class EbsVolumeDataGathererDto extends IAMAccessCredentials {
    /** 
     * The list of tags which a service is filterable by.
     * Each tag key must begin with "tag_" in order to be usuable by MeteringCo
     * 
     * @example
     * 
      [
    { filterKey: 'tag_myCoolTag123__somethingElse', filterValue: 'somethingReallyImportant1234' },
    { filterKey: 'anotherKey', filterValue: 'anotherValue' },
      ]
     *
     **/
    @IsArray()
    @IsOptional()
    public filters?: Array<any>;

    /**
     *
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.ebsVolumeProvisionedCapacity;

    @IsOptional()
    public dimensionId?: string;
}
