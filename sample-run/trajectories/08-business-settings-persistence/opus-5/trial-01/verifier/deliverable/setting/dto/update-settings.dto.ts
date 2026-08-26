import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import {
    IsBoolean,
    IsEmail,
    IsEnum,
    IsNumberString,
    IsOptional,
    IsString,
    ValidateNested,
    ValidationArguments,
} from 'class-validator';
import { InvoicePaymentTerm } from '../../invoice/entities/InvoicePaymentTerm.js';
import { IAMAccessCredentials } from '../../measurement-config/entities/measurement-config.entity.js';
import { ValidIAMRole } from './customIAMAuthorizer.js';
import { Type } from 'class-transformer';
import { StripeConnected } from '../entities/settings.entity.js';
import { AccountState } from '../entities/AccountState.js';
import { TaxCalculationType } from './TaxCalculationType.js';
import { TaxJarApiKeySet, ValidTaxJarApiKey } from './taxJarAuthorizer.js';
import { serializeError } from 'serialize-error';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { InvoiceApproval } from './InvoiceApproval.js';
import { FreeDimensionOnInvoice } from './FreeDimensionOnInvoice.js';
import { AppearanceOfferingPortalDto, PortalOfferingPageDto } from '../../portal/dto/PortalOfferingPageDto.js';

export enum InvoiceGeneration {
    perTransaction = 'perTransaction',
    consolidatedPerBillingCycle = 'consolidatedPerBillingCycle',
}
export enum ComputeCostSource {
    eks = 'eks',
    none = 'none',
}
export enum StorageCostSource {
    ebs = 'ebs',
    none = 'none',
}
export enum ArchiveCostSource {
    ebs = 'ebs',
    none = 'none',
}

export enum SendInvoiceEmail {
    send = 'true',
    doNotSend = 'false',
}
export class BasePortalPageSettings {
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsString()
    @IsOptional()
    text?: string;
}

export class InvoicePortalPageSettings extends BasePortalPageSettings {}
export class PaymentPortalPageSettings extends BasePortalPageSettings {}
export class OfferingPortalPageSettings extends BasePortalPageSettings {
    @IsOptional()
    @ApiProperty({
        type: PortalOfferingPageDto,
        minItems: 0,
        isArray: true,
    })
    public offerings?: PortalOfferingPageDto[];

    @IsOptional()
    @Type(() => AppearanceOfferingPortalDto)
    @ValidateNested()
    @ApiProperty({ type: AppearanceOfferingPortalDto })
    appearance?: AppearanceOfferingPortalDto;
}
export class CloudIAM {
    @ValidIAMRole('externalId', {
        message: 'Unable to authenticate with the IAM role and External ID provided. Please double check',
    })
    public iamRoleArn: IAMAccessCredentials['iamRoleArn'];

    @IsString()
    @IsOptional()
    public externalId?: IAMAccessCredentials['externalId'];
}

export class PortalPages {
    private static readonly logger = new Logger(PortalPages.name);
    @IsOptional()
    @Type(() => InvoicePortalPageSettings)
    @ValidateNested({ each: true })
    invoice?: InvoicePortalPageSettings;
    @IsOptional()
    @Type(() => PaymentPortalPageSettings)
    @ValidateNested({ each: true })
    payment?: PaymentPortalPageSettings;
    @IsOptional()
    @Type(() => OfferingPortalPageSettings)
    @ValidateNested({ each: true })
    offering?: OfferingPortalPageSettings;

    /**
     * Portal pages are stored as a serialized document, and are sent in by API consumers as a partial object.
     * <br><br>
     * When a serialized document (string) is given, the stored configuration is hydrated, and the platform
     * defaults are applied for anything the document does not carry.
     * <br><br>
     * When nothing, or an object, is given, __only__ the pages given are set. This keeps partial updates
     * partial, a caller naming a single page must not implicitly overwrite the pages they did not name.
     */
    constructor(pageObj?: string | PortalPages) {
        const pages = PortalPages.parse(pageObj);

        if (pages?.invoice) {
            this.invoice = { ...pages.invoice };
        }
        if (pages?.payment) {
            this.payment = { ...pages.payment };
        }
        if (pages?.offering) {
            this.offering = { ...pages.offering };
        }

        // A serialized document represents the full, stored, configuration, so defaults can be applied safely
        if (typeof pageObj === 'string') {
            PortalPages.applyDefaults(this);
        }
    }

    private static parse(pageObj?: string | PortalPages): PortalPages {
        if (!pageObj) {
            return {} as PortalPages;
        }
        if (typeof pageObj !== 'string') {
            return pageObj;
        }
        try {
            return JSON.parse(pageObj) as PortalPages;
        } catch (e) {
            PortalPages.logger.error(`Error parsing page configuration: ${serializeError(e)}, argument: ${pageObj}`);
            AuditService.publishEvent({
                data: [serializeError(e), pageObj],
                message: 'Failed to parse page configuration',
                topic: AuditScope.ERROR,
            });
            throw e;
        }
    }

    private static applyDefaults(pages: PortalPages): PortalPages {
        pages.invoice = {
            ...(pages.invoice ?? {}),
            enabled: pages.invoice?.enabled === undefined ? true : pages.invoice.enabled,
            text: pages.invoice?.text ? pages.invoice.text : 'Invoice',
        };
        pages.payment = {
            ...(pages.payment ?? {}),
            enabled: pages.payment?.enabled === undefined ? false : pages.payment.enabled,
            text: pages.payment?.text ? pages.payment.text : 'Payment',
        };
        pages.offering = {
            ...(pages.offering ?? {}),
            enabled: pages.offering?.enabled === undefined ? false : pages.offering.enabled,
            text: pages.offering?.text ? pages.offering.text : 'Plan',
        };

        PortalPages.logger.log(
            `Page configuration: ${pages.offering?.text} ${pages.payment?.text} ${pages.invoice?.text}`,
        );
        return pages;
    }

    /**
     * Hydrates a page configuration, applying the platform defaults for anything that is not set.
     * This should be used on read paths, where the full configuration of a business is being built.
     */
    static withDefaults(pageObj?: string | PortalPages): PortalPages {
        return PortalPages.applyDefaults(new PortalPages(pageObj));
    }
}

export class UpdateSettingsDto {
    private static readonly logger = new Logger(UpdateSettingsDto.name);
    @IsString()
    @IsOptional()
    public businessName?: string;

    @IsNumberString()
    @IsOptional()
    public taxRate?: string;

    @IsString()
    @IsOptional()
    public addressLine1?: string;

    @IsString()
    @IsOptional()
    public addressLine2?: string;

    @IsString()
    @IsOptional()
    public city?: string;

    @IsString()
    @IsOptional()
    public state?: string;

    @IsString()
    @IsOptional()
    public country?: string;

    @IsString()
    @IsOptional()
    public postalCode?: string;

    @IsOptional()
    @ApiHideProperty()
    public stripeConnected?: StripeConnected;

    @IsOptional()
    @IsEmail()
    public supportEmail?: string;

    @IsOptional()
    @ApiHideProperty()
    public subject?: string;

    @IsString()
    @IsOptional()
    public vatId?: string;

    @IsString()
    @IsOptional()
    public redirectionUrl?: string;

    /**
     * Whether or not the account is a sandbox account. This effects payment and other integrations like tax.
     * <br><br>
     * Example: `"sandbox"`
     * @example "sandbox"
     *
     */
    @IsEnum(AccountState, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `accountState: The value ${value} is not a valid value for the accountState field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty()
    public accountState?: AccountState;

    /**
     * Whether MeteringCo should automatically send invoices to customers.
     * <br><br>
     * Example: `"automatic"`
     * @example "automatic"
     */
    @IsEnum(InvoiceApproval, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `invoiceApproval: The value ${value} is not a valid value for the invoiceApproval field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty()
    public invoiceApproval?: InvoiceApproval;

    /**
     * When MeteringCo should automatically generate invoices.
     * <br><br>
     * Example: `"perTransaction"`
     * @example "perTransaction"
     */
    @IsEnum(InvoiceGeneration, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `invoiceApproval: The value ${value} is not a valid value for the invoiceGeneration field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty()
    public invoiceGeneration?: InvoiceGeneration;

    /**
     * Whether MeteringCo should send invoices to customers.
     * <br><br>
     * Example: `"true"`
     * @example "true"
     */
    @IsEnum(SendInvoiceEmail, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `sendInvoiceEmail: The value ${value} is not a valid value for the sendInvoiceEmail field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty()
    public sendInvoiceEmail?: SendInvoiceEmail;

    /**
     * A field to determine if line items with a 0$ rate should be shown on the invoice.
     * <br><br>
     * Example: `"hide"`
     * @example "hide"
     */
    @IsEnum(FreeDimensionOnInvoice, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `invoiceApproval: The value ${value} is not a valid value for the invoiceApproval field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @ApiProperty()
    public freeDimensionOnInvoice?: FreeDimensionOnInvoice;
    @IsEnum(InvoicePaymentTerm, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `invoicePaymentTerm: The value ${value} is not a valid value for the invoicePaymentTerm field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    public invoicePaymentTerm?: InvoicePaymentTerm;

    @IsString()
    @IsOptional()
    public customFields?: string;

    @IsString()
    @ValidTaxJarApiKey('taxJarApiKey', {
        message: 'Unable to authenticate with the TaxJar API key provided. Please double check',
    })
    @IsOptional()
    public taxJarApiKey?: string;

    @IsString()
    @IsOptional()
    public logoUrl?: string;

    @IsString()
    @IsOptional()
    public taxCategory?: string;

    @IsString()
    @IsOptional()
    public stripeAccountId?: string;

    @IsEnum(TaxCalculationType, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `taxCalculationType: The value ${value} is not a valid value for the taxCalculationType field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    @IsOptional()
    @TaxJarApiKeySet('taxCalculationType')
    public taxCalculationType?: TaxCalculationType;

    /**
     * The businessID associated with your account, not needed for full accounts, this is gathered during authentication
     * @example 'My Cool Corp'
     *
     **/
    @ApiHideProperty()
    @IsString()
    @IsOptional()
    public businessID?: string;

    @IsOptional()
    @Type(() => CloudIAM)
    @ValidateNested({ each: true })
    public cloudIAM?: CloudIAM;

    @IsOptional()
    @Type(() => PortalPages)
    @ValidateNested({ each: true })
    public pages?: PortalPages;

    /**
     * The compute cost source for your account, this enables MeteringCo to calculate your compute costs so as to determine unit costs and usage based costs.
     * The default is 'none'
     * @example 'ec2'
     * @default 'none'
     * @type {ComputeCostSource}
     */
    @IsOptional()
    @IsEnum(ComputeCostSource, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `computeCostSource: The value ${value} is not a valid value for the computeCostSource field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    public computeCostSource?: ComputeCostSource;

    /**
     * The storage cost source for your account, this enables MeteringCo to calculate your storage costs so as to determine unit costs and usage based costs.
     * The default is 'none'
     * @example 'ebs'
     * @default 'none'
     * @type {StorageCostSource}
     **/
    @IsOptional()
    @IsEnum(StorageCostSource, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `storageCostSource: The value ${value} is not a valid value for the storageCostSource field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    public storageCostSource?: StorageCostSource;

    /**
     * The archive cost source for your account, this enables MeteringCo to calculate your archive costs so as to determine unit costs and usage based costs.
     * The default is 'none'
     * @example 'ebs'
     * @default 'none'
     * @type {ArchiveCostSource}
     * */
    @IsOptional()
    @IsEnum(ArchiveCostSource, {
        message: (args: ValidationArguments) => {
            const { value, constraints } = args;
            const correctValues = Object.values(constraints[0]);
            return `archiveCostSource: The value ${value} is not a valid value for the archiveCostSource field. The correct values are: ${correctValues}`;
        },
        each: true,
    })
    public archiveCostSource?: ArchiveCostSource;
}
