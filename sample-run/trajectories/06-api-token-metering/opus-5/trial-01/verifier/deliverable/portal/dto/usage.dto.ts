import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { ApiProperty } from '@nestjs/swagger';
import { UsageResponseDocument } from '../../customer/dto/read-customer.dto.js';
import { ReadDimensionDto } from '../../dimensions/dto/read-dimension.dto.js';

class UsageResponse extends UsageResponseDocument {
    /**
     * The unique identifier of a dimension.
     * <br><br>
     * Example `"12345678-1234-1234-1234-123456789012"`
     *
     * @example "12345678-1234-1234-1234-123456789012"
     */
    dimensionId: ReadDimensionDto['dimensionId'];
}

export class UsageOfCurrentBillingCycle extends BasicResponseDTO {
    @ApiProperty({ isArray: true, type: UsageResponse, minItems: 0 })
    data: Array<UsageResponse>;
}
