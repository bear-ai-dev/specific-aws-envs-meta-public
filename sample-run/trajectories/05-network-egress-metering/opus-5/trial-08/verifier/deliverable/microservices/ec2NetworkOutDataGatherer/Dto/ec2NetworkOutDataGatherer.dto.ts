import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';
import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';

export class Ec2NetworkOutDataGathererDto extends IAMAccessCredentials {
    /**
     *
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.instanceNetworkOutBytes;

    /**
     * The dimension the run bills the outbound traffic against
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
