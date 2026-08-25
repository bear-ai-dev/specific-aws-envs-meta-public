import { ApiHideProperty, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';
import { CreateOfferingDTO } from './createOffering.dto.js';

export class UpdateOfferingDto extends PartialType(CreateOfferingDTO) {
    /**
     * The Unique ID defining the offering document
     * @example "539b7f74-3832-474e-a955-6d69c5df12d0"
     */
    @IsUUID()
    @IsOptional()
    @ApiHideProperty()
    public offeringId: string;

    /**
     * The Unique ID associated with your specific business account
     * @example myCoolCorp
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;
}
