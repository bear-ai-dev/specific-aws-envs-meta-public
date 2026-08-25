import { IsEnum, IsOptional, IsRFC3339 } from 'class-validator';
import { LedgerType } from './ledgerType';
import { ApiHideProperty } from '@nestjs/swagger';
import { ValidateFilters } from './filterValidator';

export class ReadLedgerDto {
    /**
     * The type of ledger to retrieve. These correspond to the different read responses within meteringco. EG, CUSTOMER is for GET /customer.
     * <br><br>
     * Example: `"INVOICE"`
     * @example "INVOICE"
     */
    @IsEnum(LedgerType)
    type: LedgerType;
    /**
     * The start date of the ledger to retrieve. Must be a valid <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a> date. If not provided will default  * to the beginning of last month UTCZ.
     * <br><br>
     * Example: `"2023-02-08T19:24:10Z"`
     * @example "2023-02-08T19:24:10Z"
     */
    @IsRFC3339()
    @IsOptional()
    startDate?: string;
    /**
     * The end date of the ledger to retrieve. Must be a valid <a href="https://ijmacd.github.io/rfc3339-iso8601/">RFC3339</a> date. If not provided will default to * the end of last month UTCZ.
     * <br><br>
     * Example: `"2023-02-15T20:13:11Z"`
     * @example "2023-02-15T20:13:11Z"
     */
    @IsRFC3339()
    @IsOptional()
    endDate?: string;

    @ApiHideProperty()
    businessID: string;
    /**
     * A collection of key value pairs that can be used to filter the ledger data. The keys and values are specific to the ledger type.
     * <br><br>
     * Example: `{"invoiceStatus": "PAID"}`
     * Example: `{"customerId": "e962aefe-6134-4f28-8967-a11cfe7f0bf2", "offeringId": "e962aefe-6134-4f28-8967-a11cfe7f0bf2"}`
     * @example {"invoiceStatus": "PAID"}
     */
    @ValidateFilters('filters')
    @IsOptional()
    filters?: Record<string, string | string[]>;

    /**
     * A collection of key value pairs that can be used to filter the ledger data. The keys and values are specific to the ledger type. This is an OR filter. If any of the filters match the data will be returned.
     * <br><br>
     * Example: `{"invoiceStatus": "PAID"}`
     * Example: `{"customerId": "e962aefe-6134-4f28-8967-a11cfe7f0bf2", "offeringId": "e962aefe-6134-4f28-8967-a11cfe7f0bf2"}`
     * @example {"invoiceStatus": "PAID"}
     */
    @ValidateFilters('orFilters')
    @IsOptional()
    orFilters?: Record<string, string | string[]>;

    /**
     * A collection of key value pairs that can be used to filter the ledger data. The keys and values are specific to the ledger type. This is a unique filter. The most recent element matching the filter will be returned for a given ledger group.
     * <br><br>
     * Example: `{"invoiceStatus": "PAID"}`
     * Example: `{"customerId": "e962aefe-6134-4f28-8967-a11cfe7f0bf2", "offeringId": "e962aefe-6134-4f28-8967-a11cfe7f0bf2"}`
     * @example {"invoiceStatus": "PAID"}
     */
    uniqueFilters?: string[];

    /**
     * The group by clause for the ledger data. This is an array of keys that will be used to group the ledger data.
     * <br><br>
     * Example: `["customerId", "offeringId"]`
     * @example ["customerId", "offeringId"]
     */
    groupBy?: string[];

    /**
     * The a list of filters to confirm the existance of a field or property on a ledger. This is used to confirm that a field exists on a ledger.
     * <br><br>
     * Example: `["customerId", "offeringId"]`
     * @example ["customerId", "offeringId"]
     */
    existsFilters?: string[];

    /**
     * The a list of filters to confirm the non-existance of a field or property on a ledger. This is used to confirm that a field does not exist on a ledger.
     * <br><br>
     * Example: `["softDelete"]`
     * @example ["softDelete"]
     */
    notExistsFilters?: string[];
}
