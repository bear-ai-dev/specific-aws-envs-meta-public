import { Logger } from '@nestjs/common';
import { ApiProperty, OmitType } from '@nestjs/swagger';

import { IsNotEmpty, IsString } from 'class-validator';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ReadDimensionResponseData } from 'dimensions/dto/create-dimension.dto.js';
import { CreateOfferingDTO } from './createOffering.dto.js';

export class ReadPricingDTO {
    private static readonly logger = new Logger(ReadPricingDTO.name);
    // BusinessID used for lookup (Unique ID for business)
    @IsString()
    @IsNotEmpty()
    public businessID: string;

    // Client ID for the invoice used for lookup
    @IsString()
    @IsNotEmpty()
    public offeringId: string;
}

export class ReadOfferingResponseData extends OmitType(CreateOfferingDTO, ['dimensionIds', 'businessID'] as const) {
    /**
     * Unique identifier assigned by MeteringCo.
     * <br><br>
     * Example: `539b7f74-3832-474e-a955-6d69c5df12d0`
     *
     * @example "539b7f74-3832-474e-a955-6d69c5df12d0"
     */
    public offeringId: string;

    /**
     * The list of dimensions attached to the offering.
     *
     */
    public dimensions: Array<ReadDimensionResponseData>;
}

export class ReadOfferingResponseDTO extends BasicResponseDTO {
    /**
     * A list of offerings
     *
     */
    @ApiProperty({ minItems: 0 })
    public data: Array<ReadOfferingResponseData>;
}
