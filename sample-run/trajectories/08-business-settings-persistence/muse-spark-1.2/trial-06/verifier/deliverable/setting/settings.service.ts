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

function deepMergePages(existing: PortalPages, updated: any): PortalPages {
    if (!updated) return existing;
    const existingAny: any = existing || new PortalPages();
    const result: any = {};

    // Deep copy existing with defaults
    result.invoice = existingAny.invoice ? { ...existingAny.invoice } : { enabled: true, text: 'Invoice' };
    result.payment = existingAny.payment ? { ...existingAny.payment } : { enabled: false, text: 'Payment' };
    result.offering = existingAny.offering ? { ...existingAny.offering } : { enabled: false, text: 'Plan' };
    if (existingAny.offering?.appearance) {
        result.offering.appearance = { ...existingAny.offering.appearance };
        if (existingAny.offering.appearance.pricingTable) {
            result.offering.appearance.pricingTable = { ...existingAny.offering.appearance.pricingTable };
        }
    }
    if (existingAny.offering?.offerings) {
        result.offering.offerings = [...existingAny.offering.offerings];
    }

    if (updated.invoice !== undefined) {
        result.invoice = updated.invoice === null ? updated.invoice : { ...result.invoice, ...updated.invoice };
    }
    if (updated.payment !== undefined) {
        result.payment = updated.payment === null ? updated.payment : { ...result.payment, ...updated.payment };
    }
    if (updated.offering !== undefined) {
        if (updated.offering === null) {
            result.offering = updated.offering;
        } else {
            const updOff: any = updated.offering;
            const mergedOffering: any = { ...result.offering };
            // Copy non-appearance fields
            for (const [k, v] of Object.entries(updOff)) {
                if (k !== 'appearance') {
                    mergedOffering[k] = v;
                }
            }
            // Deep merge appearance if present
            if ('appearance' in updOff) {
                const updApp: any = updOff.appearance;
                if (updApp === null) {
                    mergedOffering.appearance = null;
                } else if (updApp === undefined) {
                    // keep existing appearance (no change) - do nothing, mergedOffering already has copy
                } else {
                    const existingApp: any = result.offering.appearance || {};
                    const mergedApp: any = { ...existingApp, ...updApp };
                    if ('pricingTable' in updApp) {
                        const updPricing: any = updApp.pricingTable;
                        if (updPricing === null) {
                            mergedApp.pricingTable = null;
                        } else if (updPricing === undefined) {
                            // keep existing pricing - already handled by spread? need to ensure existing pricing retained if not overwritten
                            if (existingApp.pricingTable) mergedApp.pricingTable = { ...existingApp.pricingTable };
                        } else {
                            const existingPricing: any = existingApp.pricingTable || {};
                            mergedApp.pricingTable = { ...existingPricing, ...updPricing };
                        }
                    } else {
                        if (existingApp.pricingTable) mergedApp.pricingTable = { ...existingApp.pricingTable };
                    }
                    mergedOffering.appearance = mergedApp;
                }
            }
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
        const settingsDBModels = (await this.InfluxService.getLatestSettings({ businessID })) || [];
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
        const previousComputeCostSource = existing.computeCostSource;

        // Build merged object preserving existing values for omitted fields, overwriting even blank strings
        const merged: any = { ...existing };
        // Ensure businessID is set
        merged.businessID = businessID;

        for (const [key, value] of Object.entries(updatedFileds)) {
            if (value === undefined) continue;
            if (key === 'pages') {
                merged.pages = deepMergePages(existing.pages, value);
            } else if (key === 'cloudIAM') {
                if (value && typeof value === 'object') {
                    merged.cloudIAM = { ...(existing.cloudIAM || {}), ...(value as object) };
                } else {
                    merged[key] = value;
                }
            } else {
                merged[key] = value;
            }
        }

        const newEntity = new SettingsEntity(merged);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        // Ensure DB write and cache travel together - both must succeed; we flush DB then update cache
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);

        // Handle compute cost source scheduler side-effect atomically after successful save
        const newComputeCostSource = newEntity.computeCostSource;
        try {
            if (previousComputeCostSource !== newComputeCostSource) {
                if (newComputeCostSource === ComputeCostSource.eks && previousComputeCostSource !== ComputeCostSource.eks) {
                    await PodCostEntity.enroll(this.schedulerService, { businessID, subject: subject || businessID });
                    SettingsService.logger.log(`Enrolled compute cost scheduler for ${businessID}`);
                } else if (newComputeCostSource === ComputeCostSource.none && previousComputeCostSource === ComputeCostSource.eks) {
                    await PodCostEntity.unenroll(this.schedulerService, { businessID, subject: subject || businessID });
                    SettingsService.logger.log(`Unenrolled compute cost scheduler for ${businessID}`);
                }
            }
        } catch (e) {
            SettingsService.logger.error(`Failed to handle compute cost scheduler for ${businessID}`, e);
            // If scheduler fails, we have already committed settings; log and rethrow or continue?
            // To keep settings and scheduler in sync, we could attempt to rollback, but Influx has no rollback.
            // For now, propagate error so caller knows side-effect failed
            throw e;
        }

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
        ...profileFields
    }: UpdateSettingsDto): Promise<{ data: ReadProfileResponseData[]; message: string }> {
        SettingsService.logger.log('Updating business profile');
        SettingsService.logger.log(JSON.stringify(profileFields));
        // Reuse update logic but ensure same patch semantics over same document
        // Filter to profile fields to avoid unintended overwrites via this endpoint? Still merge correctly.
        const result = await this.update({ businessID, subject, ...profileFields } as UpdateSettingsDto);
        const profileData = result.data.map((d) => new ReadProfileResponseData(d as any));
        return { data: profileData, message: 'Profile updated successfully' };
    }
}
