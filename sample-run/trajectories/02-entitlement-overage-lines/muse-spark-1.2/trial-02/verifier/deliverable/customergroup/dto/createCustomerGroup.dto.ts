import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsArray, IsEnum, IsNotEmpty, IsObject, IsOptional, IsString, ValidationArguments } from 'class-validator';
import { BillParent } from '../entities/BillParent';

export class CreateCustomergroupDto {
    /**
     * The human-readable name of the group.
     * <br><br>
     * Example: `"My Group"`
     * @example "My Group"
     */
    @IsOptional()
    @IsString()
    groupName?: string;
    /**
     * The human-readable description of the group.
     * <br><br>
     * Example: `"This is my group."`
     * @example "This is my group."
     */
    @IsOptional()
    @IsString()
    groupDescription?: string;
    /**
     * The customerIds of the group.
     * <br><br>
     * Example: `["1234", "5678"]`
     * @example `["1234", "5678"]`
     */
    @IsArray()
    @IsOptional()
    customerIds?: string[];
    /**
     * Arbitrary metadata for the group.
     * <br><br>
     * Example: `{"key": "value"}`
     * @example `{"key": "value"}`
     */
    @IsObject()
    @IsOptional()
    metadata?: Record<string, string>;
    /**
     * The parent id of the group. This is the customerId who is considered the parent to this group.
     * <br><br>
     * Example: `"1234"`
     * @example "1234"
     */
    @IsString()
    @IsNotEmpty()
    parentId: string;

    /**
     * The businessID of the group. This is the business to which this group belongs.
     * <br><br>
     * Example: `"1234"`
     * @example "1234"
     */
    @ApiHideProperty()
    businessID: string;

    /**
     * The groupId of the group. This is the unique identifier for this group. Optional, if not provided a UUID will be generated.
     * <br><br>
     * Example: `"d9128014-8311-4615-91f5-197e36a1d17a"`
     * @example "d9128014-8311-4615-91f5-197e36a1d17a"
     */
    groupId?: string;
}

export class CreateChildRowDto {
    /**
     * The uniqueId of the child. This would be the child customerId.
     * <br><br>
     * Example: `"e962aefe-6134-4f28-8967-a11cfe7f0bf2"`
     * @example "e962aefe-6134-4f28-8967-a11cfe7f0bf2"
     */
    @IsString()
    @ApiHideProperty()
    @IsOptional()
    childId: string;

    @ApiHideProperty()
    businessID: string;
    /**
     * The parent id of the group. This is the customerId who is considered the parent to this group. This is a customerId of a parent.
     */
    @IsString()
    @ApiHideProperty()
    @IsOptional()
    parentId: string;
    /**
     * This determines if the parent should be billed for invoices of the child. Defaults to `separate`.
     * <br><br>
     * Example: `"aggregated"`
     * @example "aggregated"
     */
    @IsEnum(BillParent, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `billParent: The value ${value} is not a valid value for the billParent field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty({ default: BillParent.separate })
    billParent?: BillParent;
}
