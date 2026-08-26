import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { infrastructureType } from '../../../dimensions/dto/create-dimension.dto.js';
import { IAMAccessCredentials } from '../../../measurement-config/entities/measurement-config.entity.js';

/**
 * The parameters a scheduled EC2 network out (egress) gathering run carries.
 *
 * @example
 * {
 *   "iamRoleArn": "arn:aws:iam::100000000031:role/meteringco-egress-reader",
 *   "externalId": "nw-sbx-4417",
 *   "region": "us-east-1",
 *   "dimensionId": "dim_sbx_egress",
 *   "dimensionType": "instanceNetworkOut"
 * }
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
     * The dimension the run bills the gathered bytes against
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
