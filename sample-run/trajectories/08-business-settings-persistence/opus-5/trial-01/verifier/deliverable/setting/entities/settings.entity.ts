import { Logger } from '@nestjs/common';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { InfluxService } from '../../influx/influx.service.js';
import { Point } from '@influxdata/influxdb-client';
import {
    ArchiveCostSource,
    CloudIAM,
    ComputeCostSource,
    InvoiceGeneration,
    PortalPages,
    SendInvoiceEmail,
    StorageCostSource,
    UpdateSettingsDto,
} from '../dto/update-settings.dto.js';
import { InvoiceApproval } from '../dto/InvoiceApproval.js';
import { TaxCalculationType } from '../dto/TaxCalculationType.js';
import { SettingInfluxRow } from '../../influx/entities/settingsInfluxTable.entity.js';
import { InvoicePaymentTerm } from '../../invoice/entities/InvoicePaymentTerm.js';
import { AccountState } from './AccountState.js';
import { FreeDimensionOnInvoice } from '../dto/FreeDimensionOnInvoice.js';

export enum StripeConnected {
    connected = 'connected',
    notConnected = 'notConnected',
}

export enum FreeTrial {
    none = 'none',
    valid = 'valid',
    expired = 'expired',
}

export class SettingsEntity {
    private static readonly logger = new Logger(SettingsEntity.name);
    @ApiHideProperty()
    public static _measurement = 'Setting';
    @ApiProperty()
    public businessName: string;
    @ApiProperty()
    public taxRate: string;
    @ApiHideProperty()
    public businessID: string;
    @ApiProperty()
    public addressLine1: string;
    @ApiProperty()
    public addressLine2: string;
    @ApiProperty()
    public city: string;
    @ApiProperty()
    public state: string;
    @ApiProperty()
    public country: string;
    @ApiProperty()
    public postalCode: string;
    @ApiProperty()
    public vatId: string;
    @ApiProperty()
    public invoicePaymentTerm: InvoicePaymentTerm;
    @ApiProperty()
    public customFields: string;
    @ApiProperty()
    public logoUrl: string;
    @ApiProperty()
    public taxCategory: string;
    @ApiProperty()
    public taxJarApiKey: string;
    @ApiProperty()
    public stripeAccountId: string;
    @ApiProperty()
    public stripeConnected: StripeConnected;
    @ApiProperty()
    public taxCalculationType: TaxCalculationType;
    @ApiProperty()
    public cloudIAM: CloudIAM;
    @ApiProperty()
    public computeCostSource: ComputeCostSource;
    @ApiProperty()
    public storageCostSource: StorageCostSource;
    @ApiProperty()
    public archiveCostSource: ArchiveCostSource;
    @ApiProperty()
    public freeTrial: FreeTrial;
    @ApiProperty()
    public accountState: AccountState;
    @ApiProperty()
    public pages: PortalPages;
    @ApiProperty()
    public freeDimensionOnInvoice: FreeDimensionOnInvoice;

    @ApiProperty()
    public invoiceApproval: InvoiceApproval;

    @ApiProperty()
    public invoiceGeneration: InvoiceGeneration;

    @ApiProperty()
    public supportEmail: string;

    @ApiProperty()
    public sendInvoiceEmail: SendInvoiceEmail;

    public redirectionUrl: string;
    constructor({
        businessName = '',
        taxRate = '',
        addressLine1 = '',
        addressLine2 = '',
        city = '',
        state = '',
        country = '',
        postalCode = '',
        vatId = '',
        invoicePaymentTerm = InvoicePaymentTerm.none,
        customFields = '',
        logoUrl = '',
        taxCategory = '',
        taxCalculationType = TaxCalculationType.none,
        businessID,
        stripeAccountId,
        cloudIAM,
        computeCostSource = ComputeCostSource.none,
        storageCostSource = StorageCostSource.none,
        archiveCostSource = ArchiveCostSource.none,
        stripeConnected,
        taxJarApiKey,
        accountState,
        pages,
        invoiceApproval = InvoiceApproval.manual,
        freeDimensionOnInvoice = FreeDimensionOnInvoice.show,
        invoiceGeneration = InvoiceGeneration.perTransaction,
        supportEmail = '',
        sendInvoiceEmail = SendInvoiceEmail.send,
        redirectionUrl,
    }: UpdateSettingsDto) {
        this.businessName = businessName;
        this.taxRate = taxRate;
        this.addressLine1 = addressLine1;
        this.addressLine2 = addressLine2;
        this.city = city;
        this.state = state;
        this.country = country;
        this.postalCode = postalCode;
        this.vatId = vatId;
        this.invoicePaymentTerm = invoicePaymentTerm;
        this.customFields = customFields;
        this.logoUrl = logoUrl;
        this.taxCategory = taxCategory;
        this.taxCalculationType = taxCalculationType;
        this.businessID = businessID;
        this.stripeAccountId = stripeAccountId;
        this.cloudIAM = cloudIAM;
        this.computeCostSource = computeCostSource;
        this.storageCostSource = storageCostSource;
        this.archiveCostSource = archiveCostSource;
        this.stripeConnected = stripeConnected;
        this.taxJarApiKey = taxJarApiKey;
        this.accountState = accountState;
        this.pages = pages;
        this.invoiceApproval = invoiceApproval;
        this.freeDimensionOnInvoice = freeDimensionOnInvoice;
        this.invoiceGeneration = invoiceGeneration;
        this.supportEmail = supportEmail;
        this.sendInvoiceEmail = sendInvoiceEmail;
        this.redirectionUrl = redirectionUrl;
    }

    static transformer(settingsEntity: SettingsEntity, influxService: InfluxService): Array<Point> {
        const settingPoint = influxService.getPoint(SettingsEntity._measurement);

        const {
            businessID,
            businessName,
            taxRate,
            addressLine1,
            addressLine2,
            city,
            state,
            country,
            postalCode,
            vatId,
            invoicePaymentTerm,
            customFields,
            logoUrl,
            taxCategory,
            taxCalculationType,
            stripeAccountId,
            cloudIAM,
            computeCostSource,
            storageCostSource,
            archiveCostSource,
            stripeConnected,
            taxJarApiKey,
            accountState,
            pages,
            invoiceApproval,
            freeDimensionOnInvoice,
            invoiceGeneration,
            supportEmail,
            sendInvoiceEmail,
            redirectionUrl,
        } = settingsEntity;

        settingPoint.tag('businessID', businessID);
        settingPoint.stringField('businessName', businessName);
        settingPoint.tag('taxRate', taxRate);
        settingPoint.tag('addressLine1', addressLine1);
        settingPoint.tag('addressLine2', addressLine2);
        settingPoint.tag('city', city);
        settingPoint.tag('state', state);
        settingPoint.tag('country', country);
        settingPoint.tag('postalCode', postalCode);
        settingPoint.tag('vatId', vatId);
        settingPoint.tag('invoicePaymentTerm', invoicePaymentTerm);
        settingPoint.tag('customFields', customFields);
        settingPoint.tag('logoUrl', logoUrl);
        settingPoint.tag('taxCategory', taxCategory);
        settingPoint.tag('taxCalculationType', taxCalculationType);
        settingPoint.tag('stripeAccountId', stripeAccountId);
        settingPoint.tag('computeCostSource', computeCostSource);
        settingPoint.tag('storageCostSource', storageCostSource);
        settingPoint.tag('archiveCostSource', archiveCostSource);
        settingPoint.tag('stripeConnected', stripeConnected);
        settingPoint.tag('taxJarApiKey', taxJarApiKey);
        if (cloudIAM) {
            settingPoint.tag('cloudIAM', JSON.stringify(cloudIAM));
        }
        if (pages) {
            settingPoint.tag('pages', JSON.stringify(pages));
        }
        if (invoiceApproval) {
            settingPoint.tag('invoiceApproval', invoiceApproval);
        }
        if (freeDimensionOnInvoice) {
            settingPoint.tag('freeDimensionOnInvoice', freeDimensionOnInvoice);
        }
        if (invoiceGeneration) {
            settingPoint.tag('invoiceGeneration', invoiceGeneration);
        }
        if (supportEmail) {
            settingPoint.tag('supportEmail', supportEmail);
        }
        if (sendInvoiceEmail) {
            settingPoint.tag('sendInvoiceEmail', sendInvoiceEmail);
        }
        if (redirectionUrl) {
            settingPoint.tag('redirectionUrl', redirectionUrl);
        }
        settingPoint.tag('accountState', accountState);
        // All Entity Transformers should return an array of points, keep logic consistent, even if there is only one element
        return [settingPoint];
    }

    static dbModelToEntity(dbModel: SettingInfluxRow): SettingsEntity {
        const {
            _value: businessName,
            taxRate = '',
            businessID = '',
            addressLine1 = '',
            addressLine2 = '',
            city = '',
            state = '',
            country = '',
            postalCode = '',
            vatId = '',
            invoicePaymentTerm = InvoicePaymentTerm.none,
            customFields = '',
            logoUrl = '',
            taxCategory = '',
            taxCalculationType = TaxCalculationType.none,
            stripeAccountId = '',
            cloudIAM = '{}',
            computeCostSource = ComputeCostSource.none,
            storageCostSource = StorageCostSource.none,
            archiveCostSource = ArchiveCostSource.none,
            stripeConnected = StripeConnected.notConnected,
            taxJarApiKey = '',
            accountState = AccountState.none,
            pages,
            invoiceApproval,
            freeDimensionOnInvoice = FreeDimensionOnInvoice.show,
            invoiceGeneration = InvoiceGeneration.perTransaction,
            supportEmail = '',
            sendInvoiceEmail = SendInvoiceEmail.send,
            redirectionUrl,
        } = dbModel;
        return new SettingsEntity({
            businessName,
            taxRate,
            addressLine1,
            addressLine2,
            city,
            state,
            country,
            postalCode,
            vatId,
            invoicePaymentTerm,
            customFields,
            logoUrl,
            businessID,
            taxCategory,
            taxCalculationType,
            stripeAccountId,
            cloudIAM: cloudIAM ? JSON.parse(cloudIAM) : {},
            computeCostSource,
            storageCostSource,
            archiveCostSource,
            stripeConnected,
            taxJarApiKey,
            accountState,
            pages: PortalPages.withDefaults(pages),
            invoiceApproval: invoiceApproval || InvoiceApproval.manual,
            freeDimensionOnInvoice,
            invoiceGeneration,
            supportEmail,
            sendInvoiceEmail: sendInvoiceEmail || SendInvoiceEmail.send,
            redirectionUrl,
        });
    }
}
