import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';
import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';

export class NetworkEgressDto extends IAMAccessCredentials {
    /**
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.networkEgress;

    @IsOptional()
    public dimensionId?: string;

    @IsString()
    @IsNotEmpty()
    public region: string;
}
