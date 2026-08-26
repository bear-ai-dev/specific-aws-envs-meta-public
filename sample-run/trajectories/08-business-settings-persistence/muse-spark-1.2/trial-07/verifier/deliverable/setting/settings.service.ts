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

    private mergePortalPages(existingPages: PortalPages, incomingPages: any): PortalPages {
        if (!incomingPages) {
            // no incoming, keep existing
            return existingPages || new PortalPages();
        }
        // Deep clone existing to plain object for merging
        const existingPlain: any = existingPages ? JSON.parse(JSON.stringify(existingPages)) : {};
        const incomingPlain: any = incomingPages ? JSON.parse(JSON.stringify(incomingPages)) : {};

        const merged: any = {};

        const pageKeys = ['invoice', 'payment', 'offering'];
        for (const key of pageKeys) {
            if (incomingPlain[key] !== undefined) {
                const existingPage = existingPlain[key] || {};
                const incomingPage = incomingPlain[key] || {};
                if (key === 'offering') {
                    const mergedOffering: any = {};
                    if (incomingPage.enabled !== undefined) {
                        mergedOffering.enabled = incomingPage.enabled;
                    } else if ('enabled' in existingPage) {
                        mergedOffering.enabled = existingPage.enabled;
                    }
                    if (incomingPage.text !== undefined) {
                        mergedOffering.text = incomingPage.text;
                    } else if ('text' in existingPage) {
                        mergedOffering.text = existingPage.text;
                    }
                    if (incomingPage.offerings !== undefined) {
                        mergedOffering.offerings = incomingPage.offerings;
                    } else if ('offerings' in existingPage) {
                        mergedOffering.offerings = existingPage.offerings;
                    }
                    // appearance deep merge
                    if (incomingPage.appearance !== undefined) {
                        const existingAppearance = existingPage.appearance || {};
                        const incomingAppearance = incomingPage.appearance || {};
                        const mergedAppearance: any = {};
                        const appearanceFields = ['border', 'background', 'accent', 'radius', 'meteringcoBranding'];
                        for (const af of appearanceFields) {
                            if (incomingAppearance[af] !== undefined) {
                                mergedAppearance[af] = incomingAppearance[af];
                            } else if (af in existingAppearance) {
                                mergedAppearance[af] = existingAppearance[af];
                            }
                        }
                        if (incomingAppearance.pricingTable !== undefined) {
                            const existingPT = existingAppearance.pricingTable || {};
                            const incomingPT = incomingAppearance.pricingTable || {};
                            const mergedPT: any = {};
                            const ptFields = ['ctaBorder', 'ctaBackground', 'ctaText', 'featureListColor', 'pricePlanBackground', 'highlightedPrice', 'featureListIcon', 'showLogo'];
                            for (const pf of ptFields) {
                                if (incomingPT[pf] !== undefined) {
                                    mergedPT[pf] = incomingPT[pf];
                                } else if (pf in existingPT) {
                                    mergedPT[pf] = existingPT[pf];
                                }
                            }
                            // Only set if has any keys or existing had it
                            if (Object.keys(mergedPT).length > 0) {
                                mergedAppearance.pricingTable = mergedPT;
                            }
                        } else if (existingAppearance.pricingTable) {
                            mergedAppearance.pricingTable = existingAppearance.pricingTable;
                        }
                        // copy any other unexpected fields from existing that not merged?
                        // Preserve any existing appearance fields not in list but not overridden?
                        // Determine if any other keys in existingAppearance not handled
                        for (const k of Object.keys(existingAppearance)) {
                            if (k !== 'pricingTable' && !appearanceFields.includes(k)) {
                                if (!(k in mergedAppearance) && !(k in incomingAppearance)) {
                                    mergedAppearance[k] = existingAppearance[k];
                                }
                            }
                        }
                        // Also include any new incoming keys not in appearanceFields
                        for (const k of Object.keys(incomingAppearance)) {
                            if (k !== 'pricingTable' && !appearanceFields.includes(k)) {
                                if (!(k in mergedAppearance)) {
                                    mergedAppearance[k] = incomingAppearance[k];
                                }
                            }
                        }
                        if (Object.keys(mergedAppearance).length > 0) {
                            mergedOffering.appearance = mergedAppearance;
                        }
                    } else if (existingPage.appearance) {
                        mergedOffering.appearance = existingPage.appearance;
                    }
                    // preserve any other existing offering fields not explicitly handled and not overridden
                    for (const k of Object.keys(existingPage)) {
                        if (!(k in mergedOffering) && !['enabled','text','offerings','appearance'].includes(k)) {
                            if (!(k in incomingPage)) {
                                mergedOffering[k] = existingPage[k];
                            }
                        }
                    }
                    for (const k of Object.keys(incomingPage)) {
                        if (!(k in mergedOffering) && !['enabled','text','offerings','appearance'].includes(k)) {
                            mergedOffering[k] = incomingPage[k];
                        }
                    }
                    merged[key] = mergedOffering;
                } else {
                    // invoice or payment: enabled and text
                    const mergedPage: any = {};
                    if (incomingPage.enabled !== undefined) {
                        mergedPage.enabled = incomingPage.enabled;
                    } else if ('enabled' in existingPage) {
                        mergedPage.enabled = existingPage.enabled;
                    }
                    if (incomingPage.text !== undefined) {
                        mergedPage.text = incomingPage.text;
                    } else if ('text' in existingPage) {
                        mergedPage.text = existingPage.text;
                    }
                    // preserve other fields
                    for (const k of Object.keys(existingPage)) {
                        if (!(k in mergedPage) && !(k in incomingPage)) {
                            mergedPage[k] = existingPage[k];
                        }
                    }
                    for (const k of Object.keys(incomingPage)) {
                        if (!(k in mergedPage)) {
                            mergedPage[k] = incomingPage[k];
                        }
                    }
                    merged[key] = mergedPage;
                }
            } else {
                if (existingPlain[key] !== undefined) {
                    merged[key] = existingPlain[key];
                }
            }
        }
        // Construct new PortalPages without re-applying defaults that would overwrite merged values
        const result = new PortalPages();
        // Overwrite with merged, preserving defaults for any missing pages
        if (merged.invoice) result.invoice = merged.invoice;
        if (merged.payment) result.payment = merged.payment;
        if (merged.offering) result.offering = merged.offering;
        // If any page missing after merge, keep existing's defaults already set via constructor? But we overwrote only those present, so if missing, constructor defaults remain.
        // Ensure missing pages from both existing and incoming still have defaults: constructor already set them.
        // However if existing had no page and incoming also no page, constructor defaults are fine.

        // But note: constructor sets invoice to {enabled:true, text:'Invoice'} etc. If existing had custom values, we already replaced.
        // To avoid constructor overwriting our merged values with defaults after we assigned, we assigned after construction, so okay.

        // Edge: if existingPlain was empty and merged has nothing, result keeps defaults.
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
        const hasComputeChange = Object.prototype.hasOwnProperty.call(updatedFileds, 'computeCostSource');
        const prevCompute = existing.computeCostSource;

        // Build merged object
        const merged: any = {};

        const scalarFields = [
            'businessName',
            'taxRate',
            'addressLine1',
            'addressLine2',
            'city',
            'state',
            'country',
            'postalCode',
            'vatId',
            'invoicePaymentTerm',
            'customFields',
            'logoUrl',
            'taxCategory',
            'taxCalculationType',
            'stripeAccountId',
            'stripeConnected',
            'taxJarApiKey',
            'accountState',
            'invoiceApproval',
            'freeDimensionOnInvoice',
            'invoiceGeneration',
            'supportEmail',
            'sendInvoiceEmail',
            'redirectionUrl',
            'storageCostSource',
            'archiveCostSource',
            'computeCostSource',
        ];

        for (const field of scalarFields) {
            if ((updatedFileds as any)[field] !== undefined) {
                merged[field] = (updatedFileds as any)[field];
            } else {
                merged[field] = (existing as any)[field];
            }
        }

        // cloudIAM deep merge
        if ((updatedFileds as any).cloudIAM !== undefined) {
            const incomingIAM: any = (updatedFileds as any).cloudIAM;
            const existingIAM: any = (existing as any).cloudIAM || {};
            if (incomingIAM && typeof incomingIAM === 'object') {
                merged['cloudIAM'] = {
                    iamRoleArn: incomingIAM.iamRoleArn !== undefined ? incomingIAM.iamRoleArn : existingIAM.iamRoleArn,
                    externalId: incomingIAM.externalId !== undefined ? incomingIAM.externalId : existingIAM.externalId,
                };
            } else {
                merged['cloudIAM'] = incomingIAM;
            }
        } else {
            merged['cloudIAM'] = (existing as any).cloudIAM;
        }

        // pages deep merge
        if ((updatedFileds as any).pages !== undefined) {
            merged['pages'] = this.mergePortalPages(existing.pages, (updatedFileds as any).pages);
        } else {
            merged['pages'] = existing.pages;
        }

        const newEntity = new SettingsEntity({
            ...merged,
            businessID,
        });

        const { loadPoints } = this.InfluxService;
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);

        // scheduler side effect must travel with save: handle after successful write, but atomically within same operation
        const newCompute = newEntity.computeCostSource;
        if (hasComputeChange && prevCompute !== newCompute) {
            try {
                if (newCompute === ComputeCostSource.eks) {
                    await PodCostEntity.enroll(this.schedulerService, { businessID, subject: subject || '' });
                } else if (newCompute === ComputeCostSource.none && prevCompute === ComputeCostSource.eks) {
                    await PodCostEntity.unenroll(this.schedulerService, { businessID, subject: subject || '' });
                }
            } catch (e) {
                // If scheduler fails, we should not silently ignore? But to keep atomicity, log and rethrow? For now log.
                SettingsService.logger.error('Failed to handle compute cost scheduler transition', e);
                throw e;
            }
        }

        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        return { data: [responseDto], message: 'Setting updated successfully' };
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

    async updateProfile({ businessID, subject, ...updatedFields }: UpdateSettingsDto): Promise<{ data: ReadProfileResponseData[]; message: string }> {
        // Reuse main update which already merges correctly, then map to profile response
        const result = await this.update({ businessID, subject, ...updatedFields } as UpdateSettingsDto);
        const profileData = result.data.map((d) => new ReadProfileResponseData(d as any));
        // Also need to ensure cache already set by update; just return profile shape
        return { data: profileData, message: 'Profile updated successfully' };
    }
}
