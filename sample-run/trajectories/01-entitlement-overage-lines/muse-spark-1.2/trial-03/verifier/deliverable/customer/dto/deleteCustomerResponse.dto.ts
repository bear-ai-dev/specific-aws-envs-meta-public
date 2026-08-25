import { BasicResponseDTO } from '../../basicResponseDTO';

export class DeleteCustomerResponseDto extends BasicResponseDTO {
    /**
     * Unique identifier assigned by MeteringCo
     * <br><br>
     * Example: `"e345f409-daca-4144-91d2-0a0f87c96581"`
     * @example "e345f409-daca-4144-91d2-0a0f87c96581"
     */
    customerId: string;
}
