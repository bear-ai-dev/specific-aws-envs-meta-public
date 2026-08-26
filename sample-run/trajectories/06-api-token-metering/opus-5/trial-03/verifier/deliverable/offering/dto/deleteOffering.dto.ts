import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';

export class DeleteOfferingDTO {
    @IsString()
    @IsNotEmpty()
    @IsOptional()
    @ApiHideProperty()
    public businessID: string;

    /**
     * The Unique ID defining the offering document
     * @example "539b7f74-3832-474e-a955-6d69c5df12d0"
     */
    @IsString()
    @IsNotEmpty()
    @ApiProperty()
    public offeringId: string;
}

export class DeleteOfferingResponse extends BasicResponseDTO {
    /**
     * The Unique ID defining the offering document
     * @example "539b7f74-3832-474e-a955-6d69c5df12d0"
     */
    public offeringId: string;
}
