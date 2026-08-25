import { InvoiceLineItem } from '../../../invoice/entities/invoice.entity.js';
import { ReadOfferingResponseData } from '../../../offering/dto/readOffering.dto.js';
import { ReadSettingsResponseData } from '../../../setting/dto/read-setting.dto.js';

/**
 * The scheduler payload for a metered invoice run. The catalogue the run works
 * from is kept in the business' billing bucket rather than in the payload,
 * because the sales team edits it far more often than the schedule.
 */
export class InvoiceLineGathererDto {
    public businessID: string;
    /**
     * The bucket holding the business' billing catalogue.
     */
    public catalogueBucket: string;
    /**
     * The key of the catalogue document inside that bucket.
     */
    public catalogueKey: string;
    /**
     * Start of the period being invoiced, ISO 8601.
     */
    public periodStart?: string;
    /**
     * End of the period being invoiced, ISO 8601.
     */
    public periodEnd?: string;
}

/**
 * One customer's place in the catalogue: the offering they are on.
 */
export class CatalogueEnrolment {
    public customerId: string;
    public offeringId: string;
}

/**
 * The billing catalogue as it is stored. `usageNamespace`, `usageMetricName`
 * and `usagePeriod` say where in the metric store the aggregated usage for this
 * business is published; every series there is keyed by business, customer and
 * dimension.
 */
export class BillingCatalogue {
    public businessID: string;
    public periodStart: string;
    public periodEnd: string;
    public usageNamespace: string;
    public usageMetricName: string;
    public usagePeriod: number;
    public settings: ReadSettingsResponseData;
    public offerings: Array<ReadOfferingResponseData>;
    public enrolments: Array<CatalogueEnrolment>;
}

/**
 * What the run produces for one customer: the lines their invoice would carry.
 */
export class CustomerInvoiceLines {
    public customerId: string;
    public offeringId: string;
    public offeringName: string;
    public lineItems: Array<InvoiceLineItem>;
}
