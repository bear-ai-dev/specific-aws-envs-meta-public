import { PartialType } from '@nestjs/swagger';
import { CreateServiceDto } from './createService.dto.js';
import { IsString, IsOptional } from 'class-validator';
import { ApiHideProperty } from '@nestjs/swagger';

export class UpdateServiceDto extends PartialType(CreateServiceDto) {
    /**
     * The identifier of the service that you want to update.
     *
     * @example 'e88595c2-abec-4a86-af34-daad942ae0c5'
     *
     *
     **/
    @IsString()
    @IsOptional()
    public serviceId: string;

    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     *
     * @example 'My Cool Corp'
     *
     **/
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;
}
