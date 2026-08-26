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

function mergeCloudIAM(existing: any, updated: any) {
    if (updated === undefined) return existing;
    if (!existing) return updated;
    if (!updated) return existing;
    const result: any = { ...existing };
    if (updated.iamRoleArn !== undefined) result.iamRoleArn = updated.iamRoleArn;
    if (updated.externalId !== undefined) result.externalId = updated.externalId;
    return result;
}

function mergeWithNull(existing: any, updated: any): any {
    if (updated === undefined) return existing;
    if (updated === null) return undefined;
    if (typeof updated !== 'object' || Array.isArray(updated) || updated === null) {
        return updated;
    }
    const result: any = { ...(existing || {}) };
    for (const k of Object.keys(updated)) {
        const v: any = (updated as any)[k];
        if (v === null) {
            delete result[k];
        } else if (v !== undefined) {
            if (typeof v === 'object' && !Array.isArray(v) && v !== null && typeof result[k] === 'object' && result[k] !== null && !Array.isArray(result[k])) {
                const merged = mergeWithNull(result[k], v);
                if (merged === undefined) delete result[k];
                else result[k] = merged;
            } else {
                result[k] = v;
            }
        }
    }
    // clean undefined
    Object.keys(result).forEach(k => result[k] === undefined && delete result[k]);
    return result;
}

function mergePages(existing: PortalPages | any, updated: PortalPages | any): PortalPages | any {
    if (updated === undefined || updated === null) return existing;
    const existingSafe = existing || {};
    const result: any = { ...existingSafe };
    if (updated.invoice !== undefined) {
        const existingInvoice = existingSafe.invoice || { enabled: true, text: 'Invoice' };
        if (updated.invoice === null) {
            delete result.invoice;
        } else {
            result.invoice = mergeWithNull(existingInvoice, updated.invoice);
        }
    }
    if (updated.payment !== undefined) {
        const existingPayment = existingSafe.payment || { enabled: false, text: 'Payment' };
        if (updated.payment === null) {
            delete result.payment;
        } else {
            result.payment = mergeWithNull(existingPayment, updated.payment);
        }
    }
    if (updated.offering !== undefined) {
        if (updated.offering === null) {
            delete result.offering;
        } else {
            const existingOffering = existingSafe.offering || { enabled: false, text: 'Plan' };
            let mergedOffering: any = { ...existingOffering };
            // handle offerings array separately
            const hasOfferings = 'offerings' in updated.offering;
            const hasAppearance = 'appearance' in updated.offering;
            // merge top-level offering fields except appearance and offerings
            for (const k of Object.keys(updated.offering)) {
                if (k === 'appearance' || k === 'offerings') continue;
                const v: any = (updated.offering as any)[k];
                if (v === null) delete mergedOffering[k];
                else if (v !== undefined) mergedOffering[k] = v;
            }
            if (hasOfferings) {
                const v: any = (updated.offering as any).offerings;
                if (v === null) delete mergedOffering.offerings;
                else if (v !== undefined) mergedOffering.offerings = v;
            }
            if (hasAppearance) {
                const v: any = (updated.offering as any).appearance;
                if (v === null) {
                    delete mergedOffering.appearance;
                } else if (v !== undefined) {
                    const existingApp = existingOffering.appearance || {};
                    mergedOffering.appearance = mergeWithNull(existingApp, v);
                }
            }
            // clean undefined
            Object.keys(mergedOffering).forEach(k => mergedOffering[k] === undefined && delete mergedOffering[k]);
            result.offering = mergedOffering;
        }
    }
    return result as PortalPages;
}

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

    async update({
        businessID,
        subject,
        ...updatedFileds
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFileds));

        const existing = await this.findLatestSetting({ businessID });

        const merged: any = {
            businessID,
            businessName: updatedFileds.businessName !== undefined ? updatedFileds.businessName : existing.businessName,
            taxRate: updatedFileds.taxRate !== undefined ? updatedFileds.taxRate : existing.taxRate,
            addressLine1: updatedFileds.addressLine1 !== undefined ? updatedFileds.addressLine1 : existing.addressLine1,
            addressLine2: updatedFileds.addressLine2 !== undefined ? updatedFileds.addressLine2 : existing.addressLine2,
            city: updatedFileds.city !== undefined ? updatedFileds.city : existing.city,
            state: updatedFileds.state !== undefined ? updatedFileds.state : existing.state,
            country: updatedFileds.country !== undefined ? updatedFileds.country : existing.country,
            postalCode: updatedFileds.postalCode !== undefined ? updatedFileds.postalCode : existing.postalCode,
            vatId: updatedFileds.vatId !== undefined ? updatedFileds.vatId : existing.vatId,
            invoicePaymentTerm: updatedFileds.invoicePaymentTerm !== undefined ? updatedFileds.invoicePaymentTerm : existing.invoicePaymentTerm,
            customFields: updatedFileds.customFields !== undefined ? updatedFileds.customFields : existing.customFields,
            logoUrl: updatedFileds.logoUrl !== undefined ? updatedFileds.logoUrl : existing.logoUrl,
            taxCategory: updatedFileds.taxCategory !== undefined ? updatedFileds.taxCategory : existing.taxCategory,
            taxCalculationType: updatedFileds.taxCalculationType !== undefined ? updatedFileds.taxCalculationType : existing.taxCalculationType,
            stripeAccountId: updatedFileds.stripeAccountId !== undefined ? updatedFileds.stripeAccountId : existing.stripeAccountId,
            stripeConnected: updatedFileds.stripeConnected !== undefined ? updatedFileds.stripeConnected : existing.stripeConnected,
            cloudIAM: updatedFileds.cloudIAM !== undefined ? mergeCloudIAM(existing.cloudIAM, updatedFileds.cloudIAM) : existing.cloudIAM,
            computeCostSource: updatedFileds.computeCostSource !== undefined ? updatedFileds.computeCostSource : existing.computeCostSource,
            storageCostSource: updatedFileds.storageCostSource !== undefined ? updatedFileds.storageCostSource : existing.storageCostSource,
            archiveCostSource: updatedFileds.archiveCostSource !== undefined ? updatedFileds.archiveCostSource : existing.archiveCostSource,
            accountState: updatedFileds.accountState !== undefined ? updatedFileds.accountState : existing.accountState,
            pages: updatedFileds.pages !== undefined ? mergePages(existing.pages, updatedFileds.pages) : existing.pages,
            invoiceApproval: updatedFileds.invoiceApproval !== undefined ? updatedFileds.invoiceApproval : existing.invoiceApproval,
            freeDimensionOnInvoice: updatedFileds.freeDimensionOnInvoice !== undefined ? updatedFileds.freeDimensionOnInvoice : existing.freeDimensionOnInvoice,
            invoiceGeneration: updatedFileds.invoiceGeneration !== undefined ? updatedFileds.invoiceGeneration : existing.invoiceGeneration,
            supportEmail: updatedFileds.supportEmail !== undefined ? updatedFileds.supportEmail : existing.supportEmail,
            sendInvoiceEmail: updatedFileds.sendInvoiceEmail !== undefined ? updatedFileds.sendInvoiceEmail : existing.sendInvoiceEmail,
            redirectionUrl: updatedFileds.redirectionUrl !== undefined ? updatedFileds.redirectionUrl : existing.redirectionUrl,
            taxJarApiKey: updatedFileds.taxJarApiKey !== undefined ? updatedFileds.taxJarApiKey : existing.taxJarApiKey,
        };

        const newEntity = new SettingsEntity(merged);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        const responseDto = new ReadSettingsResponseData(newEntity);

        // handle compute cost scheduler transition
        const prevCompute = existing.computeCostSource ?? ComputeCostSource.none;
        const nextCompute = newEntity.computeCostSource ?? ComputeCostSource.none;
        if (prevCompute !== nextCompute) {
            try {
                if (prevCompute !== ComputeCostSource.eks && nextCompute === ComputeCostSource.eks) {
                    await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
                } else if (prevCompute === ComputeCostSource.eks && nextCompute !== ComputeCostSource.eks) {
                    await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
                }
            } catch (e) {
                SettingsService.logger.error(`Failed to handle compute cost scheduler transition for ${businessID}`, e);
            }
        }

        // Travel with it: loadPoints and cache set together
        const { loadPoints } = this.InfluxService;
        await Promise.all([
            loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel),
            cacheManager.set(businessID, JSON.stringify(responseDto), 604800),
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

        const merged: any = {
            businessID,
            // profile fields
            businessName: updatedFields.businessName !== undefined ? updatedFields.businessName : existing.businessName,
            addressLine1: updatedFields.addressLine1 !== undefined ? updatedFields.addressLine1 : existing.addressLine1,
            addressLine2: updatedFields.addressLine2 !== undefined ? updatedFields.addressLine2 : existing.addressLine2,
            city: updatedFields.city !== undefined ? updatedFields.city : existing.city,
            state: updatedFields.state !== undefined ? updatedFields.state : existing.state,
            country: updatedFields.country !== undefined ? updatedFields.country : existing.country,
            postalCode: updatedFields.postalCode !== undefined ? updatedFields.postalCode : existing.postalCode,
            supportEmail: updatedFields.supportEmail !== undefined ? updatedFields.supportEmail : existing.supportEmail,
            sendInvoiceEmail: updatedFields.sendInvoiceEmail !== undefined ? updatedFields.sendInvoiceEmail : existing.sendInvoiceEmail,
            stripeAccountId: updatedFields.stripeAccountId !== undefined ? updatedFields.stripeAccountId : existing.stripeAccountId,
            redirectionUrl: updatedFields.redirectionUrl !== undefined ? updatedFields.redirectionUrl : existing.redirectionUrl,
            // preserve all other fields from existing
            taxRate: existing.taxRate,
            vatId: existing.vatId,
            invoicePaymentTerm: existing.invoicePaymentTerm,
            customFields: existing.customFields,
            logoUrl: existing.logoUrl,
            taxCategory: existing.taxCategory,
            taxCalculationType: existing.taxCalculationType,
            stripeConnected: existing.stripeConnected,
            cloudIAM: existing.cloudIAM,
            computeCostSource: existing.computeCostSource,
            storageCostSource: existing.storageCostSource,
            archiveCostSource: existing.archiveCostSource,
            accountState: existing.accountState,
            pages: existing.pages,
            invoiceApproval: existing.invoiceApproval,
            freeDimensionOnInvoice: existing.freeDimensionOnInvoice,
            invoiceGeneration: existing.invoiceGeneration,
            taxJarApiKey: existing.taxJarApiKey,
        };

        const newEntity = new SettingsEntity(merged);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        const responseDto = new ReadSettingsResponseData(newEntity);
        const profileDto = new ReadProfileResponseData(newEntity);

        const { loadPoints } = this.InfluxService;
        await Promise.all([
            loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel),
            cacheManager.set(businessID, JSON.stringify(responseDto), 604800),
        ]);

        return { data: [profileDto], message: 'Business profile updated successfully' };
    }
}
