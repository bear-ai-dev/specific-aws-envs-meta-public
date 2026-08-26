import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';

export class Ec2NetworkOutDataGathererDto extends IAMAccessCredentials {
    /**
     *
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.instanceNetworkOut;

    /**
     * The dimension the outbound network traffic is billed against
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
