import { ApiHideProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';

export class DeleteDimensionDto {
    @IsString()
    @IsNotEmpty()
    @ApiHideProperty()
    public businessID: string;

    /**
     * The unique ID for a dimension
     * @example "12340-abcfe-asdh24-asdhfj"
     */
    @IsString()
    @IsNotEmpty()
    public dimensionId: string;

    constructor(dbModel) {
        if (dbModel) {
            const { businessID, dimensionId } = dbModel;
            this.businessID = businessID;
            this.dimensionId = dimensionId;
        }
    }
}

export class DeleteDimensionResponseDto extends BasicResponseDTO {
    declare message: 'deleted dimension document';
}
