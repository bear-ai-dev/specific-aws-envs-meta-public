import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';

export class NetworkOutDataGathererDto extends IAMAccessCredentials {
    /**
     *
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.networkOut | infrastructureType.ec2NetworkOut | string;

    @IsOptional()
    public dimensionId?: string;

    @IsString()
    @IsNotEmpty()
    public region: string;
}
