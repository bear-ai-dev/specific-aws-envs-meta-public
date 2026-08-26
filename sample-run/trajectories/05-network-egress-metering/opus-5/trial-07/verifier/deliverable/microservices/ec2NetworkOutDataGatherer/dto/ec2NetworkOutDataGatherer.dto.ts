import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';
import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';

/**
 * The parameters a scheduled EC2 network out (outbound data transfer) collection run carries.
 */
export class Ec2NetworkOutDataGathererDto extends IAMAccessCredentials {
    /**
     *
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.ec2NetworkOut;

    /**
     * The dimension the run bills the outbound traffic against
     */
    @IsOptional()
    public dimensionId?: string;

    /**
     * The region holding the instances which are metered
     */
    @IsString()
    @IsNotEmpty()
    public region: string;
}
