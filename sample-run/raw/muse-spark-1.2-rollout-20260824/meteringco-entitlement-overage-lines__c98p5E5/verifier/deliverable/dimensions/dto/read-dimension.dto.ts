import { ApiHideProperty, ApiProperty, IntersectionType, PickType } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';

import { ReadDimensionResponseData } from './create-dimension.dto.js';

export class ReadDimensionDto {
    /**
     * The Unique ID associated with your specific business account
     * @example "myCoolCorp"
     */
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID: string;

    /**
     * The unique ID for a dimension
     * @example "12340-abcfe-asdh24-asdhfj"
     */
    @IsString()
    @IsNotEmpty()
    @ApiProperty({
        name: 'dimensionId',
        type: String,
        example: '8a7b5f91-3b85-4cf4-8585-dcdf17f49004',
        description: 'The unique ID for a dimension',
    })
    public dimensionId: string;
}

export class ReadDimensionResponse extends BasicResponseDTO {
    /**
     * Array of dimensions
     */
    @ApiProperty({ minItems: 0 })
    data: ReadDimensionResponseData[];
}
