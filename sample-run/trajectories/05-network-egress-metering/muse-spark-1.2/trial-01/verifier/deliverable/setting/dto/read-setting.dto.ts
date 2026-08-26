import { ApiProperty } from '@nestjs/swagger';
import { BasicResponseDTO } from '../../basicResponseDTO.js';
import { SettingsEntity } from '../entities/settings.entity.js';
import { AccountState } from '../entities/AccountState.js';
import { SendInvoiceEmail, UpdateSettingsDto } from './update-settings.dto.js';

export class ReadSettingsResponse extends BasicResponseDTO {
    public data: ReadSettingsResponseData[];
}

export class ReadSettingsResponseData extends UpdateSettingsDto {
    /**
     * Wether or not the account is a sandbox account. This effects payment and other integrations like tax.
     * <br><br>
     * Example: `"sandbox"`
     * @example "sandbox"
     *
     */
    @ApiProperty({ default: AccountState.production, enum: AccountState })
    public declare accountState?: AccountState;
    constructor(entity: SettingsEntity) {
        super();
        if (entity) {
            this.businessName = entity.businessName;
            this.taxRate = entity.taxRate;
            this.addressLine1 = entity.addressLine1;
            this.addressLine2 = entity.addressLine2;
            this.city = entity.city;
            this.state = entity.state;
            this.country = entity.country;
            this.postalCode = entity.postalCode;
            this.vatId = entity.vatId;
            this.invoicePaymentTerm = entity.invoicePaymentTerm;
            this.customFields = entity.customFields;
            this.logoUrl = entity.logoUrl;
            this.taxCategory = entity.taxCategory;
            this.taxCalculationType = entity.taxCalculationType;
            this.stripeAccountId = entity.stripeAccountId;
            this.cloudIAM = entity.cloudIAM;
            this.computeCostSource = entity.computeCostSource;
            this.storageCostSource = entity.storageCostSource;
            this.archiveCostSource = entity.archiveCostSource;
            this.stripeConnected = entity.stripeConnected;
            this.taxJarApiKey = entity.taxJarApiKey;
            this.accountState = entity.accountState;
            this.pages = entity.pages;
            this.invoiceApproval = entity.invoiceApproval;
            this.freeDimensionOnInvoice = entity.freeDimensionOnInvoice;
            this.invoiceGeneration = entity.invoiceGeneration;
            this.supportEmail = entity.supportEmail;
            this.sendInvoiceEmail = entity.sendInvoiceEmail;
            this.redirectionUrl = entity.redirectionUrl;
        }
    }
}

export class ReadProfileResponseData {
    /**
     * The Name for the Business Entity using MeteringCo
     * <br><br>
     * Example: `"My Smart Business Name"`
     * @example "My Smart Business Name"
     */
    public businessName?: string;

    /**
     * Street number and name (address line 1)
     * <br><br>
     * Example: `"123 Success Street"`
     * @example "123 Success Street"
     */
    public addressLine1?: string;

    /**
     * Apartment or unit and its number (address line 2)
     * <br><br>
     * Example: `"Suite 100"`
     * @example "Suite 100"
     */
    public addressLine2?: string;

    /**
     * City of Business Entity's Location
     * <br><br>
     * Example: `"San Francisco"`
     * @example "San Francisco"
     */
    public city?: string;

    /**
     * State of Business Entity's Location
     * <br><br>
     * Example: `"CA"`
     * @example "CA"
     */
    public state?: string;

    /**
     * Country of Business Entity's Location
     * <br><br>
     * Example: `"USA"`
     * @example "USA"
     */
    public country?: string;

    /**
     * Postal code of Business Entity's Location
     * <br><br>
     * Example: `"94188"`
     * @example "94188"
     */
    public postalCode?: string;

    /**
     * Email address utilized by the Business Entity for customer support
     * <br><br>
     * Example: `"support@mybusiness.com"`
     * @example "support@mybusiness.com"
     */
    public supportEmail?: string;
    /**
     * Whether MeteringCo should send invoices to customers.
     * <br><br>
     * Example: `"true"`
     * @example "true"
     */
    public sendInvoiceEmail?: SendInvoiceEmail;

    /**
     * The Stripe Account ID for the Business Entity. Only present if the account is connected to Stripe.
     * <br><br>
     * Example: `"acct_1J2k3l4m5n6o7p8q9r0s"`
     * @example "acct_1J2k3l4m5n6o7p8q9r0s"
     */
    public stripeAccountId?: string;

    /**
     * A URL to redirect to after relevant connection, or payment actions.
     */
    public redirectionUrl?: string;

    constructor(entity: SettingsEntity | ReadSettingsResponseData) {
        if (entity) {
            this.businessName = entity.businessName;
            this.addressLine1 = entity.addressLine1;
            this.addressLine2 = entity.addressLine2;
            this.city = entity.city;
            this.state = entity.state;
            this.country = entity.country;
            this.postalCode = entity.postalCode;
            this.supportEmail = entity.supportEmail;
            this.sendInvoiceEmail = entity.sendInvoiceEmail;
            this.stripeAccountId = entity.stripeAccountId;
            this.redirectionUrl = entity.redirectionUrl;
        }
    }
}
export class ReadProfileResponse extends BasicResponseDTO {
    /**
     * The data for the profile, will return only one element.
     */
    public data: ReadProfileResponseData[];
}
