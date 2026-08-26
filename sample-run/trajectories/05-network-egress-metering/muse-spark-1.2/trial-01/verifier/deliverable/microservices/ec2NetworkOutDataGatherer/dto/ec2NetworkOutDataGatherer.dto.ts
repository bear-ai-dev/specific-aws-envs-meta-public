import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';

export class Ec2NetworkOutDataGathererDto extends IAMAccessCredentials {
    /**
     * Static string indicating the dimensionType
     */
    @IsString()
    @IsNotEmpty()
    public dimensionType: infrastructureType.ec2NetworkOut;

    @IsOptional()
    public dimensionId?: string;

    @IsString()
    @IsNotEmpty()
    public region: string;
}
