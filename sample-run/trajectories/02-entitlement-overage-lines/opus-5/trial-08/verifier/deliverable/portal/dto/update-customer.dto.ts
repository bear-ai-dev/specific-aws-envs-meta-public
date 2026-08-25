import { Address } from '../../customer/dto/create-customer.dto.js';
import { IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdatePortalCustomerDto {
    @ValidateNested({ each: true })
    @Type(() => Address)
    public address: Address;

    @IsString()
    @IsUUID()
    @IsOptional()
    public offeringId?: string;
}

export class UpdateCustomerResponseDto {
    /**
     * The unique identifier assigned by MeteringCo
     * @example e345f409-daca-4144-91d2-0a0f87c96581
     */
    public customerId: string;

    /**
     * The human-readable message from the Create Customer API
     * <br><br>
     * Example: `"Customer updated"`
     * @example "Customer updated"
     * */
    public message: 'Customer updated';
}
