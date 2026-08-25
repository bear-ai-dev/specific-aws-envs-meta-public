import { BasicResponseDTO } from '../../basicResponseDTO';
import { CustomerGroupEntity } from '../entities/customergroup.entity';
import { ReadChildRowResponseData } from './ReadChildRowResponseData';

export class ReadCustomerGroupDto {
    /**
     * The groupId of the group. This is the unique identifier for this group. Optional, if not provided a UUID will be generated.
     * <br><br>
     * Example: `"d9128014-8311-4615-91f5-197e36a1d17a"`
     * @example "d9128014-8311-4615-91f5-197e36a1d17a"
     */
    groupId?: string;
    /**
     * The parent id of the group. This is the customerId who is considered the parent to this group.
     * <br><br>
     * Example: `"1234"`
     * @example "1234"
     */
    parentId?: string;
    /**
     * The businessID of the group. This is the business to which this group belongs.
     * <br><br>
     * Example: `"1234"`
     * @example "1234"
     */
    businessID: string;
}

export class ReadCustomerGroupResponseData {
    /**
     * The human-readable name of the group.
     * <br><br>
     * Example: `"My Group"`
     * @example "My Group"
     */
    groupName: string;
    /**
     * The human-readable description of the group.
     * <br><br>
     * Example: `"This is my group."`
     * @example "This is my group."
     */
    groupDescription?: string;
    /**
     * The customerIds of the group.
     * <br><br>
     * Example: `["1234", "5678"]`
     * @example `["1234", "5678"]`
     */
    customerIds?: string[];
    /**
     * Arbitrary metadata for the group.
     * <br><br>
     * Example: `{"key": "value"}`
     * @example `{"key": "value"}`
     */
    metadata?: Record<string, string>;
    /**
     * The parent id of the group. This is the customerId who is considered the parent to this group.
     * <br><br>
     * Example: `"1234"`
     * @example "1234"
     */
    parentId: string;

    /**
     * The groupId of the group. This is the unique identifier for this group. Optional, if not provided a UUID will be generated.
     * <br><br>
     * Example: `"d9128014-8311-4615-91f5-197e36a1d17a"`
     * @example "d9128014-8311-4615-91f5-197e36a1d17a"
     */
    groupId: string;

    constructor(groupEntity: CustomerGroupEntity) {
        if (groupEntity) {
            this.groupName = groupEntity.groupName;
            this.groupDescription = groupEntity.groupDescription;
            this.metadata = groupEntity.metadata;
            this.parentId = groupEntity.parentId;
        }
    }
}

export class ReadChildRowResponse extends BasicResponseDTO {
    data: ReadChildRowResponseData[];
}
export class ReadCustomerGroupResponse extends BasicResponseDTO {
    data: ReadCustomerGroupResponseData[];
}
