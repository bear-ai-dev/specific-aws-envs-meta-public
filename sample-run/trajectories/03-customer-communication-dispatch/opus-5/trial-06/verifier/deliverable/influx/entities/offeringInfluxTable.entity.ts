import { OfferingPackageEntity } from '../../offering/entities/offeringPackage.entity.js';
import { BaseInfluxTable } from './baseInfluxTable.entity.js';

export class OfferingInfluxRow extends BaseInfluxTable {
    public static _measurement = 'OfferingDocument';

    /**
     *
     * The visibility of the offering, specifically if its private or public.
     * A private offering can only be associated with a single service, while a public offering can be associated with many.
     *
     * Private offerings are typically used for enterprise deals which contain discounts or prepaid credits.
     *
     * @example "private"
     * @example "public"
     * **/
    public offeringVisibility?: string;
    /**
     * Discount associated with the package, is applied to the total package which includes each associated dimension
     * @example 20%
     * @example 0%
     */

    public discount?: string;

    /**
     * PrePaid Credit amount assoaciated with the package, is taken off the total calculated
     * @example $20.00
     */
    public prepaidCredit?: string;

    /**
     * The type of plan
     */
    public offeringType?: string;

    /**
     * The price of the subscription.
     */
    public subscriptionPrice?: string;

    /**
     * The time frame when an automatic bill should be sent leave empty for no automated billing
     * @example monthly
     * @example weekly
     * @example annual
     */
    public billingCycle?: string;

    /**
     * The Human Readable name for the offering
     */
    public declare _value: OfferingPackageEntity['offeringName'];

    public declare _field: string;

    /**
     * Currently only USD is supported as a currency, more will come in the future with localization. It is not required that you pass in USD. However you can if you would like.
     */
    public currency = 'USD';

    /**
     * The collection of dimensions, these are the specific units which need to be metered for on a service. Each dimension must be unique for a given offering.
     * For post requests to the price document endpoint it is NOT required.
     * To add dimensions use the /dimensions endpoint
     *
     */
    public dimensionIds?: Array<string>;

    /**
     * The Unique ID associated with your specific business account
     * @example myCoolCorp
     */
    public businessID: string;

    /**
     * The Unique ID defining the offering document
     * @example 092f9444-851a-43fb-9503-2228dc01b1be
     */
    public offeringId: string;

    [key: string]: any;
}
