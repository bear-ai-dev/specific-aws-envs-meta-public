import { OrganizationEntity } from '../../users/entities/organization.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class OrganizationInfluxRow extends BaseInfluxTable {
    public static _measurement = OrganizationEntity._measurement;

    /**
     * The Unique ID associated with your specific business account
     * @example myCoolCorp
     */
    public businessID: string;

    public organizationDisplayName: string;
    public subject: string;

    /**
     * The organization state, this is used to determine if the organization is live or not.
     * @example live
     *
     **/
    public declare _value: string;
}
