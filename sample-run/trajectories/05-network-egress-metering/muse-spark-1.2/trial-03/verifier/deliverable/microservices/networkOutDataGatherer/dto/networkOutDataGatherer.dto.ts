import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';

export class NetworkOutDataGathererDto extends IAMAccessCredentials {
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.networkOut;

    @IsOptional()
    public dimensionId?: string;

    @IsString()
    @IsNotEmpty()
    public region: string;
}
