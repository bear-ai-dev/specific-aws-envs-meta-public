import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';
import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';

/**
 * The parameters a scheduled EC2 outbound network traffic (NetworkOut) collection run carries.
 */
export class Ec2NetworkOutDataGathererDto extends IAMAccessCredentials {
    /**
     *
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.instanceNetworkOut;

    /**
     * The dimension the run is billing the outbound traffic against
     */
    @IsOptional()
    public dimensionId?: string;

    /**
     * The region of the customers account which is looked in for metered instances
     */
    @IsString()
    @IsNotEmpty()
    public region: string;
}
