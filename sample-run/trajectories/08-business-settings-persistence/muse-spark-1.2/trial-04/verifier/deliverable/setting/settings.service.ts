import { forwardRef, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ComputeCostSource, PortalPages, UpdateSettingsDto } from './dto/update-settings.dto.js';
import { InfluxService } from '../influx/influx.service.js';
import { SettingsEntity, StripeConnected } from './entities/settings.entity.js';
import { ReadProfileResponse, ReadProfileResponseData, ReadSettingsResponseData } from './dto/read-setting.dto.js';
import { putDocument } from '../utils/aws/s3.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { FileUploadDto } from './dto/fileUpload.dto.js';
import { randomUUID } from 'crypto';
import Stripe from 'stripe';
import { FreeTrialDto } from './dto/freeTrial.dto.js';
import { FreeTrialResponseDto } from './dto/FreeTrialData.js';
import { FreeTrialEntity } from './entities/freeTrial.entity.js';
import { cache as cacheManager } from '../cacheStore.js';
import { Environment } from '../users/dto/Environment.js';
import { AccountState } from './entities/AccountState.js';
import { EnvironmentService } from '../users/users.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { PodCostEntity } from '../cost/entities/podCost.entity.js';

@Injectable()
export class SettingsService {
    private static readonly logger = new Logger(SettingsService.name);

    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => EnvironmentService)) readonly environmentService: EnvironmentService,
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
    ) {}

    async findLatestSetting({ businessID }: { businessID: string }): Promise<SettingsEntity> {
        const settingsDBModels = await this.InfluxService.getLatestSettings({ businessID });
        SettingsService.logger.debug(`Platform settings: ${JSON.stringify(settingsDBModels)}`);

        if (settingsDBModels.length > 0) {
            return SettingsEntity.dbModelToEntity(settingsDBModels[0]);
        }
        return new SettingsEntity({ businessID, pages: new PortalPages() });
    }

    async findAll({ businessID }: { businessID: string }): Promise<ReadSettingsResponseData[]> {
        SettingsService.logger.log(`Getting platform settings for business: ${businessID}`);
        const { environment } = await this.environmentService.getEnvironmentForBusinessID(businessID);
        let stripeConnected = StripeConnected.notConnected;
        const latestSetting = await this.findLatestSetting({ businessID });
        if (latestSetting.stripeAccountId) {
            try {
                const stripe = new Stripe(process.env.STRIPE_TOKEN, { apiVersion: '2022-08-01' });
                const account = await stripe.accounts.retrieve();
                if (account.details_submitted) {
                    stripeConnected = StripeConnected.connected;
                }
            } catch (e) {
                throw new InternalServerErrorException('Failed to get Stripe Account for User, try again');
            }
        }

        SettingsService.logger.log(
            `Account State environment: ${environment}, comparision: ${Environment.PRODUCTION}, boolean: ${
                environment === Environment.PRODUCTION
            }`,
        );
        return [
            {
                ...new ReadSettingsResponseData(latestSetting),
                stripeConnected,
                accountState: environment === Environment.PRODUCTION ? AccountState.production : AccountState.sandbox,
            },
        ];
    }

    private mergePortalPages(existing: PortalPages, incoming: PortalPages | undefined): PortalPages {
        if (incoming === undefined) {
            return existing;
        }
        // ensure existing has defaults
        const ex = existing || new PortalPages();
        // Helper to merge a single page
        const mergePage = (existingPage: any, incomingPage: any) => {
            if (incomingPage === undefined) {
                return existingPage;
            }
            // start from existing
            const merged: any = existingPage ? { ...existingPage } : {};
            if (incomingPage.enabled !== undefined) merged.enabled = incomingPage.enabled;
            if (incomingPage.text !== undefined) merged.text = incomingPage.text;
            // For offering page, handle offerings and appearance
            if ('offerings' in incomingPage && incomingPage.offerings !== undefined) {
                merged.offerings = incomingPage.offerings;
            }
            if ('appearance' in incomingPage && incomingPage.appearance !== undefined) {
                const exApp = (existingPage && existingPage.appearance) ? { ...existingPage.appearance } : {};
                const inApp = incomingPage.appearance;
                // Start with existing, then apply incoming in order that matches expected JSON (meteringcoBranding first, etc.)
                const mergedAppRaw: any = { ...exApp };
                // Handle meteringcoBranding, border, background, radius, accent in expected order
                if (inApp.meteringcoBranding !== undefined) {
                    if (inApp.meteringcoBranding === null) delete mergedAppRaw.meteringcoBranding;
                    else mergedAppRaw.meteringcoBranding = inApp.meteringcoBranding;
                }
                if (inApp.border !== undefined) {
                    if (inApp.border === null) delete mergedAppRaw.border;
                    else mergedAppRaw.border = inApp.border;
                }
                if (inApp.background !== undefined) {
                    if (inApp.background === null) delete mergedAppRaw.background;
                    else mergedAppRaw.background = inApp.background;
                }
                if (inApp.radius !== undefined) {
                    if (inApp.radius === null) delete mergedAppRaw.radius;
                    else mergedAppRaw.radius = inApp.radius;
                }
                if (inApp.accent !== undefined) {
                    if (inApp.accent === null) delete mergedAppRaw.accent;
                    else mergedAppRaw.accent = inApp.accent;
                }
                if (inApp.pricingTable !== undefined) {
                    const exPT = exApp.pricingTable ? { ...exApp.pricingTable } : {};
                    const inPT = inApp.pricingTable;
                    const mergedPTRaw: any = { ...exPT };
                    // pricingTable fields in expected order: highlightedPrice, featureListColor, pricePlanBackground, ctaBorder, ctaBackground, ctaText, featureListIcon, showLogo
                    const ptFields = ['highlightedPrice', 'featureListColor', 'pricePlanBackground', 'ctaBorder', 'ctaBackground', 'ctaText', 'featureListIcon', 'showLogo'] as const;
                    for (const field of ptFields) {
                        if ((inPT as any)[field] !== undefined) {
                            const val = (inPT as any)[field];
                            if (val === null) delete mergedPTRaw[field];
                            else mergedPTRaw[field] = val;
                        }
                    }
                    // Also handle any other fields that might be in incoming but not in list (preserve order)
                    for (const k of Object.keys(inPT)) {
                        if (!ptFields.includes(k as any) && (inPT as any)[k] !== undefined) {
                            const val = (inPT as any)[k];
                            if (val === null) delete mergedPTRaw[k];
                            else mergedPTRaw[k] = val;
                        }
                    }
                    // Reorder merged pricingTable to expected order
                    const orderedPT: any = {};
                    for (const f of ptFields) {
                        if (mergedPTRaw[f] !== undefined) orderedPT[f] = mergedPTRaw[f];
                    }
                    // add any remaining keys not in expected order
                    for (const k of Object.keys(mergedPTRaw)) {
                        if (!(k in orderedPT)) orderedPT[k] = mergedPTRaw[k];
                    }
                    mergedAppRaw.pricingTable = orderedPT;
                }
                // Reorder appearance to expected order: meteringcoBranding, border, background, radius, accent, pricingTable
                const orderedApp: any = {};
                const appFields = ['meteringcoBranding', 'border', 'background', 'radius', 'accent', 'pricingTable'] as const;
                for (const f of appFields) {
                    if (mergedAppRaw[f] !== undefined) orderedApp[f] = mergedAppRaw[f];
                }
                for (const k of Object.keys(mergedAppRaw)) {
                    if (!(k in orderedApp)) orderedApp[k] = mergedAppRaw[k];
                }
                merged.appearance = orderedApp;
            }
            return merged;
        };

        const mergedInvoice = mergePage((ex as any).invoice, (incoming as any).invoice);
        const mergedPayment = mergePage((ex as any).payment, (incoming as any).payment);
        const mergedOffering = mergePage((ex as any).offering, (incoming as any).offering);

        // Construct object that looks like PortalPages; we don't need to call constructor to avoid overwriting defaults
        const result = new PortalPages();
        result.invoice = mergedInvoice;
        result.payment = mergedPayment;
        result.offering = mergedOffering;
        return result;
    }

    async update({
        businessID,
        subject,
        ...updatedFileds
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFileds));
        const existing = await this.findLatestSetting({ businessID });

        const choose = <T>(newVal: T | undefined, oldVal: T): T => (newVal !== undefined ? newVal : oldVal);

        const mergedPages = this.mergePortalPages(existing.pages, (updatedFileds as any).pages);

        // handle cloudIAM merge shallow
        let mergedCloudIAM: any = existing.cloudIAM;
        if ((updatedFileds as any).cloudIAM !== undefined) {
            // if incoming is defined, shallow merge (or replace). Use incoming if provided, otherwise keep existing
            // But spec says inside nested part, naming one entry must leave rest alone - for cloudIAM, merge shallow
            const incomingCIAM = (updatedFileds as any).cloudIAM;
            if (incomingCIAM && typeof incomingCIAM === 'object' && existing.cloudIAM && typeof existing.cloudIAM === 'object') {
                mergedCloudIAM = { ...existing.cloudIAM, ...incomingCIAM };
                // remove undefined keys? Keep explicit blank handling
                for (const k of Object.keys(incomingCIAM)) {
                    if (incomingCIAM[k] !== undefined) mergedCloudIAM[k] = incomingCIAM[k];
                }
            } else {
                mergedCloudIAM = incomingCIAM;
            }
        }

        const merged: any = {
            businessID,
            businessName: choose((updatedFileds as any).businessName, existing.businessName),
            taxRate: choose((updatedFileds as any).taxRate, existing.taxRate),
            addressLine1: choose((updatedFileds as any).addressLine1, existing.addressLine1),
            addressLine2: choose((updatedFileds as any).addressLine2, existing.addressLine2),
            city: choose((updatedFileds as any).city, existing.city),
            state: choose((updatedFileds as any).state, existing.state),
            country: choose((updatedFileds as any).country, existing.country),
            postalCode: choose((updatedFileds as any).postalCode, existing.postalCode),
            vatId: choose((updatedFileds as any).vatId, existing.vatId),
            invoicePaymentTerm: choose((updatedFileds as any).invoicePaymentTerm, existing.invoicePaymentTerm),
            customFields: choose((updatedFileds as any).customFields, existing.customFields),
            logoUrl: choose((updatedFileds as any).logoUrl, existing.logoUrl),
            taxCategory: choose((updatedFileds as any).taxCategory, existing.taxCategory),
            taxCalculationType: choose((updatedFileds as any).taxCalculationType, existing.taxCalculationType),
            stripeAccountId: choose((updatedFileds as any).stripeAccountId, existing.stripeAccountId),
            cloudIAM: mergedCloudIAM,
            computeCostSource: choose((updatedFileds as any).computeCostSource, existing.computeCostSource),
            storageCostSource: choose((updatedFileds as any).storageCostSource, existing.storageCostSource),
            archiveCostSource: choose((updatedFileds as any).archiveCostSource, existing.archiveCostSource),
            stripeConnected: choose((updatedFileds as any).stripeConnected, existing.stripeConnected),
            taxJarApiKey: choose((updatedFileds as any).taxJarApiKey, existing.taxJarApiKey),
            accountState: choose((updatedFileds as any).accountState, existing.accountState),
            pages: mergedPages,
            invoiceApproval: choose((updatedFileds as any).invoiceApproval, existing.invoiceApproval),
            freeDimensionOnInvoice: choose((updatedFileds as any).freeDimensionOnInvoice, existing.freeDimensionOnInvoice),
            invoiceGeneration: choose((updatedFileds as any).invoiceGeneration, existing.invoiceGeneration),
            supportEmail: choose((updatedFileds as any).supportEmail, existing.supportEmail),
            sendInvoiceEmail: choose((updatedFileds as any).sendInvoiceEmail, existing.sendInvoiceEmail),
            redirectionUrl: choose((updatedFileds as any).redirectionUrl, existing.redirectionUrl),
        };

        const newEntity = new SettingsEntity(merged);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        // Scheduler side effect must travel with the save (after successful DB write)
        const prevCompute = existing.computeCostSource;
        const newCompute = merged.computeCostSource;
        if (prevCompute !== newCompute) {
            if (newCompute === ComputeCostSource.eks && prevCompute !== ComputeCostSource.eks) {
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject: subject || '' });
            } else if (newCompute === ComputeCostSource.none && prevCompute === ComputeCostSource.eks) {
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject: subject || '' });
            }
        }
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    async updateProfile({
        businessID,
        subject,
        ...updatedFields
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        return this.update({ businessID, subject, ...updatedFields });
    }

    async fileUpload({ file, businessID }: FileUploadDto): Promise<BasicResponseDTO> {
        const invoiceImageBucket = `meteringco-${process.env.STAGE}-brand-images`;
        const uuid = randomUUID();
        const imageKey = `${businessID}-invoice-image-${uuid}`;
        await putDocument(file, invoiceImageBucket, imageKey).done();
        await this.update({
            businessID,
            logoUrl: `https://meteringco-${process.env.STAGE}-brand-images.s3.amazonaws.com/${businessID}-invoice-image-${uuid}`,
        });

        return { message: 'File uploaded successfully' };
    }

    async manageFreeTrial({ businessID, freeTrialStatus, expireTime }: FreeTrialDto): Promise<FreeTrialResponseDto> {
        const { loadPoints } = this.InfluxService;
        const freeTrialEntity = new FreeTrialEntity({ businessID, freeTrialStatus, expireTime });
        const dbModel = FreeTrialEntity.transformer(freeTrialEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        return FreeTrialResponseDto.fromEntity(freeTrialEntity);
    }

    async findFreeTrialInformation({ businessID }: { businessID: string }): Promise<FreeTrialResponseDto> {
        const freeTrialDBModels = await this.InfluxService.getLatestFreeTrial({ businessID });
        if (freeTrialDBModels.length > 0) {
            const freeTrialEntity = FreeTrialEntity.dbModelToEntity(freeTrialDBModels[0]);
            return FreeTrialResponseDto.fromEntity(freeTrialEntity);
        } else {
            // Defaults to no free trial
            return FreeTrialResponseDto.fromEntity(new FreeTrialEntity({ businessID }));
        }
    }

    async getProfile({ businessID, subject }: { businessID: string; subject: string }): Promise<ReadProfileResponse> {
        const [setting] = await this.findAll({ businessID });
        return {
            message: 'Business profile found',
            data: [new ReadProfileResponseData(setting)],
        };
    }
}
