import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';
import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';

/**
 * The parameters a scheduled EC2 network out (egress) data gathering run carries.
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
     * The dimension the usage gathered by the run is billed against
     */
    @IsOptional()
    public dimensionId?: string;

    /**
     * The region the metered instances live in
     */
    @IsString()
    @IsNotEmpty()
    public region: string;
}
