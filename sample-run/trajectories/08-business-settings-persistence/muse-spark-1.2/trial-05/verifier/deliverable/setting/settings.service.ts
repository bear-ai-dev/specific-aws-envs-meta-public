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

    private mergePages(existingPages: PortalPages, incomingPages: any): PortalPages {
        if (incomingPages === undefined || incomingPages === null) {
            return existingPages;
        }
        // Ensure existingPages has structure
        const existing: any = existingPages || new PortalPages();
        const incoming: any = incomingPages;

        const result: any = {};

        // invoice page
        if (incoming.invoice !== undefined) {
            const exInv = existing.invoice || { enabled: true, text: 'Invoice' };
            const incInv = incoming.invoice || {};
            result.invoice = {
                enabled: incInv.enabled !== undefined ? incInv.enabled : exInv.enabled,
                text: incInv.text !== undefined ? incInv.text : exInv.text,
            };
            // Preserve any other unknown fields? spread then override
            // If incoming has extra keys, include them
            for (const k of Object.keys(incInv)) {
                if (k !== 'enabled' && k !== 'text') {
                    result.invoice[k] = incInv[k];
                }
            }
            // Also preserve existing extra keys not overwritten
            for (const k of Object.keys(exInv)) {
                if (!(k in result.invoice)) {
                    result.invoice[k] = exInv[k];
                }
            }
        } else {
            result.invoice = existing.invoice;
        }

        // payment page
        if (incoming.payment !== undefined) {
            const exPay = existing.payment || { enabled: false, text: 'Payment' };
            const incPay = incoming.payment || {};
            result.payment = {
                enabled: incPay.enabled !== undefined ? incPay.enabled : exPay.enabled,
                text: incPay.text !== undefined ? incPay.text : exPay.text,
            };
            for (const k of Object.keys(incPay)) {
                if (k !== 'enabled' && k !== 'text') {
                    result.payment[k] = incPay[k];
                }
            }
            for (const k of Object.keys(exPay)) {
                if (!(k in result.payment)) {
                    result.payment[k] = exPay[k];
                }
            }
        } else {
            result.payment = existing.payment;
        }

        // offering page
        if (incoming.offering !== undefined) {
            const exOff = existing.offering || { enabled: false, text: 'Plan' };
            const incOff = incoming.offering || {};
            result.offering = {
                enabled: incOff.enabled !== undefined ? incOff.enabled : exOff.enabled,
                text: incOff.text !== undefined ? incOff.text : exOff.text,
            };
            // offerings array
            if (incOff.offerings !== undefined) {
                result.offering.offerings = incOff.offerings;
            } else if (exOff.offerings !== undefined) {
                result.offering.offerings = exOff.offerings;
            }
            // preserve other offering fields besides enabled/text/offerings/appearance
            for (const k of Object.keys(exOff)) {
                if (!['enabled', 'text', 'offerings', 'appearance'].includes(k) && !(k in result.offering)) {
                    result.offering[k] = exOff[k];
                }
            }
            for (const k of Object.keys(incOff)) {
                if (!['enabled', 'text', 'offerings', 'appearance'].includes(k)) {
                    result.offering[k] = incOff[k];
                }
            }

            // appearance deep merge
            if (incOff.appearance !== undefined) {
                const exApp = exOff.appearance || {};
                const incApp = incOff.appearance || {};
                const mergedApp: any = {};
                const appKeys = ['border', 'background', 'accent', 'radius', 'meteringcoBranding'];
                for (const key of appKeys) {
                    if (incApp[key] !== undefined) {
                        mergedApp[key] = incApp[key];
                    } else if (exApp[key] !== undefined) {
                        mergedApp[key] = exApp[key];
                    }
                }
                // Preserve any other keys in appearance
                for (const k of Object.keys(exApp)) {
                    if (k !== 'pricingTable' && !(k in mergedApp)) {
                        mergedApp[k] = exApp[k];
                    }
                }
                for (const k of Object.keys(incApp)) {
                    if (k !== 'pricingTable' && !(k in mergedApp)) {
                        mergedApp[k] = incApp[k];
                    }
                }

                // pricingTable deep merge
                if (incApp.pricingTable !== undefined) {
                    const exPT = exApp.pricingTable || {};
                    const incPT = incApp.pricingTable || {};
                    const mergedPT: any = {};
                    const ptKeys = ['ctaBorder', 'ctaBackground', 'ctaText', 'featureListColor', 'pricePlanBackground', 'highlightedPrice', 'featureListIcon', 'showLogo'];
                    for (const key of ptKeys) {
                        if (incPT[key] !== undefined) {
                            mergedPT[key] = incPT[key];
                        } else if (exPT[key] !== undefined) {
                            mergedPT[key] = exPT[key];
                        }
                    }
                    // preserve extra keys
                    for (const k of Object.keys(exPT)) {
                        if (!(k in mergedPT)) {
                            mergedPT[k] = exPT[k];
                        }
                    }
                    for (const k of Object.keys(incPT)) {
                        if (!(k in mergedPT)) {
                            mergedPT[k] = incPT[k];
                        }
                    }
                    // Only set pricingTable if it has any keys
                    if (Object.keys(mergedPT).length > 0) {
                        mergedApp.pricingTable = mergedPT;
                    }
                } else if (exApp.pricingTable !== undefined) {
                    mergedApp.pricingTable = exApp.pricingTable;
                }

                // Only set appearance if has keys
                if (Object.keys(mergedApp).length > 0) {
                    result.offering.appearance = mergedApp;
                }
            } else if (exOff.appearance !== undefined) {
                result.offering.appearance = exOff.appearance;
            }
        } else {
            result.offering = existing.offering;
        }

        return result as PortalPages;
    }

    private mergeCloudIAM(existing: any, incoming: any): any {
        if (incoming === undefined || incoming === null) {
            return existing;
        }
        const result: any = { ...(existing || {}) };
        for (const key of Object.keys(incoming)) {
            const val = incoming[key];
            if (val !== undefined) {
                result[key] = val;
            }
        }
        // Also need to handle case where incoming explicitly has undefined? we already skip
        return result;
    }

    private mergeSettings(existing: SettingsEntity, patch: any): any {
        const merged: any = { ...existing };
        for (const key of Object.keys(patch)) {
            const value = patch[key];
            if (value === undefined) continue;
            if (key === 'pages') {
                merged.pages = this.mergePages(existing.pages, value);
            } else if (key === 'cloudIAM') {
                merged.cloudIAM = this.mergeCloudIAM(existing.cloudIAM, value);
            } else {
                merged[key] = value;
            }
        }
        return merged;
    }

    async update({
        businessID,
        subject,
        ...updatedFileds
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFileds));
        const existing = await this.findLatestSetting({ businessID });
        const merged = this.mergeSettings(existing, updatedFileds);
        // Ensure businessID is preserved
        merged.businessID = businessID;

        const newEntity = new SettingsEntity(merged);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);

        // Determine scheduler transition - only if caller explicitly sent computeCostSource
        const computeWasProvided = Object.prototype.hasOwnProperty.call(updatedFileds, 'computeCostSource') && updatedFileds.computeCostSource !== undefined;
        const oldCompute = existing.computeCostSource;
        // newEntity's computeCostSource is merged value (either patched or old)
        const newCompute = newEntity.computeCostSource;

        // Prepare scheduler actions but don't execute until DB write succeeds? To travel with it, we await together.
        const schedulerActions: Promise<any>[] = [];
        if (computeWasProvided && oldCompute !== newCompute) {
            if (newCompute === ComputeCostSource.eks) {
                if (this.schedulerService) {
                    schedulerActions.push(PodCostEntity.enroll(this.schedulerService, { businessID, subject }));
                }
            } else if (oldCompute === ComputeCostSource.eks && newCompute === ComputeCostSource.none) {
                if (this.schedulerService) {
                    schedulerActions.push(PodCostEntity.unenroll(this.schedulerService, { businessID, subject } as any));
                }
            }
        }

        const responseDto = new ReadSettingsResponseData(newEntity);

        // One consequence has to travel with it rather than sit beside it - make cache and DB write travel together, and scheduler travel with them
        // Use Promise.all to make them transactional-like
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        // After successful DB write, update cache and scheduler together so they travel with the save
        await Promise.all([
            cacheManager.set(businessID, JSON.stringify(responseDto), 604800),
            ...schedulerActions,
        ]);

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

    async updateProfile({
        businessID,
        subject,
        ...updatedFields
    }: any): Promise<{ data: ReadProfileResponseData[]; message: string }> {
        SettingsService.logger.log('Updating business profile');
        SettingsService.logger.log(JSON.stringify(updatedFields));
        const existing = await this.findLatestSetting({ businessID });
        // Only allow profile fields - but we merge any provided fields through same mergeSettings to ensure consistent behavior
        // Filter to profile-allowed keys to prevent accidental overwrite of non-profile fields? However spec says it should be able to save that screen's own field set, over the same document, behaving the same way.
        // So we accept any profile fields and merge them; if caller sends non-profile fields via this endpoint, we would also merge them? To be safe, we only merge provided keys regardless, but we restrict to profile fields list.
        const profileKeys = ['businessName','addressLine1','addressLine2','city','state','country','postalCode','supportEmail','sendInvoiceEmail','stripeAccountId','redirectionUrl','logoUrl','taxRate','vatId','invoicePaymentTerm'] as const;
        // However better to just merge whatever was sent, as long as it's a known Settings field - that way it behaves same as update
        const filteredPatch: any = {};
        for (const key of Object.keys(updatedFields)) {
            const val = updatedFields[key];
            if (val !== undefined) {
                filteredPatch[key] = val;
            }
        }
        const merged = this.mergeSettings(existing, filteredPatch);
        merged.businessID = businessID;
        const newEntity = new SettingsEntity(merged);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        const responseDto = new ReadProfileResponseData(newEntity);
        const settingsResponseDto = new ReadSettingsResponseData(newEntity);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        await cacheManager.set(businessID, JSON.stringify(settingsResponseDto), 604800);
        return { data: [responseDto], message: 'Profile updated successfully' };
    }
}
