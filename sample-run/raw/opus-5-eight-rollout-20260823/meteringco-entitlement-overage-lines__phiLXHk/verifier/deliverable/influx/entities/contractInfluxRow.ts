import { BaseInfluxTable } from './baseInfluxTable.entity';

export class ContractInfluxRow extends BaseInfluxTable {
    public declare _value: string;
    public declare _field: string;
    public businessID: string;
    public customerId: string;
    public offeringId?: string;
    public discountName?: string;
    public discountPercentage?: string;
    public discountEndDate?: string;
    public offeringEnrollmentDate?: string;
    public freeTrialEndDate?: string;
    public dimensionOverrides?: string;
}
