import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';

export class Ec2EgressDataGathererDto extends IAMAccessCredentials {
    /**
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.egress | infrastructureType.networkOut | infrastructureType.instanceEgress | infrastructureType.ec2Egress;

    @IsOptional()
    public dimensionId?: string;

    @IsString()
    @IsNotEmpty()
    public region: string;
}
