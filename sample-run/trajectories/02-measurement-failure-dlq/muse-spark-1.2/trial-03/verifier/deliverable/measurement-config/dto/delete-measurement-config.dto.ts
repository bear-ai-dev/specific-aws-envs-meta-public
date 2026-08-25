import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';

export class DeleteMeasurementConfigResponse extends BasicResponseDTO {
    /**
     * The unique identifier assigned by MeteringCo
     * <br><br>
     * Example: `"193b6967-1783-434f-85cb-a6fc4e1e385b"`
     * @example 193b6967-1783-434f-85cb-a6fc4e1e385b
     */
    public measurementId: string;
}
