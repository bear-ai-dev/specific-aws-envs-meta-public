import { forwardRef, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PortalPages, UpdateSettingsDto, ComputeCostSource } from './dto/update-settings.dto.js';
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
        // Deep copy existing to avoid mutation
        const merged: PortalPages = JSON.parse(JSON.stringify(existingPages || new PortalPages()));
        // Ensure defaults if missing
        if (!merged.invoice) merged.invoice = { enabled: true, text: 'Invoice' } as any;
        if (!merged.payment) merged.payment = { enabled: false, text: 'Payment' } as any;
        if (!merged.offering) merged.offering = { enabled: false, text: 'Plan' } as any;

        if (!incomingPages || typeof incomingPages !== 'object') {
            return merged;
        }
        if (incomingPages.invoice !== undefined && incomingPages.invoice !== null) {
            const src = incomingPages.invoice;
            const tgt: any = merged.invoice || { enabled: true, text: 'Invoice' };
            for (const [k, v] of Object.entries(src)) {
                if (v !== undefined) (tgt as any)[k] = v;
            }
            merged.invoice = tgt;
        }
        if (incomingPages.payment !== undefined && incomingPages.payment !== null) {
            const src = incomingPages.payment;
            const tgt: any = merged.payment || { enabled: false, text: 'Payment' };
            for (const [k, v] of Object.entries(src)) {
                if (v !== undefined) (tgt as any)[k] = v;
            }
            merged.payment = tgt;
        }
        if (incomingPages.offering !== undefined && incomingPages.offering !== null) {
            const srcOff: any = incomingPages.offering;
            const tgtOff: any = merged.offering || { enabled: false, text: 'Plan' };
            for (const [k, v] of Object.entries(srcOff)) {
                if (k === 'appearance') continue;
                if (v !== undefined) tgtOff[k] = v;
            }
            if (srcOff.appearance !== undefined && srcOff.appearance !== null) {
                const srcApp: any = srcOff.appearance;
                const tgtApp: any = tgtOff.appearance || {};
                for (const [k, v] of Object.entries(srcApp)) {
                    if (k === 'pricingTable' && v !== null && typeof v === 'object') {
                        const srcPt: any = v;
                        const tgtPt: any = tgtApp.pricingTable || {};
                        for (const [pk, pv] of Object.entries(srcPt)) {
                            if (pv !== undefined) tgtPt[pk] = pv;
                        }
                        tgtApp.pricingTable = tgtPt;
                    } else {
                        if (v !== undefined) tgtApp[k] = v;
                    }
                }
                tgtOff.appearance = tgtApp;
            }
            merged.offering = tgtOff;
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
        const previousCompute = (existing as any).computeCostSource ?? ComputeCostSource.none;

        // Build merged object starting from existing
        const merged: any = { ...existing };
        // Handle pages deep merge separately
        if ((updatedFileds as any).pages !== undefined) {
            merged.pages = this.mergePages(existing.pages, (updatedFileds as any).pages);
            // Remove pages from shallow copy loop to avoid overwrite
            const { pages, ...rest } = updatedFileds as any;
            for (const [k, v] of Object.entries(rest)) {
                if (v !== undefined) merged[k] = v;
            }
            // Special handling for cloudIAM deep merge
            if ((rest as any).cloudIAM !== undefined && (rest as any).cloudIAM !== null && typeof (rest as any).cloudIAM === 'object') {
                const existingCloud: any = (existing as any).cloudIAM || {};
                const incomingCloud: any = (rest as any).cloudIAM;
                const mergedCloud: any = { ...existingCloud };
                for (const [ck, cv] of Object.entries(incomingCloud)) {
                    if (cv !== undefined) mergedCloud[ck] = cv;
                }
                merged.cloudIAM = mergedCloud;
            }
        } else {
            for (const [k, v] of Object.entries(updatedFileds as any)) {
                if (v !== undefined) {
                    if (k === 'cloudIAM' && v !== null && typeof v === 'object') {
                        const existingCloud: any = (existing as any).cloudIAM || {};
                        const incomingCloud: any = v;
                        const mergedCloud: any = { ...existingCloud };
                        for (const [ck, cv] of Object.entries(incomingCloud)) {
                            if (cv !== undefined) mergedCloud[ck] = cv;
                        }
                        merged[k] = mergedCloud;
                    } else {
                        merged[k] = v;
                    }
                }
            }
        }
        merged.businessID = businessID;

        const newEntity = new SettingsEntity(merged);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);

        const newCompute = (newEntity as any).computeCostSource ?? ComputeCostSource.none;
        if (previousCompute !== newCompute) {
            try {
                if (previousCompute !== ComputeCostSource.eks && newCompute === ComputeCostSource.eks) {
                    await PodCostEntity.enroll(this.schedulerService as any, { businessID, subject: subject ?? '' });
                } else if (previousCompute === ComputeCostSource.eks && newCompute !== ComputeCostSource.eks) {
                    await PodCostEntity.unenroll(this.schedulerService as any, { businessID, subject: subject ?? '' });
                }
            } catch (e) {
                SettingsService.logger.error(`Failed to handle compute cost scheduler transition: ${e}`, (e as any)?.stack);
                // Do not fail the whole update if scheduler fails; scheduler is best-effort
            }
        }

        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    async updateProfile({
        businessID,
        subject,
        ...updatedFileds
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        // Profile update shares same merging behavior over same document
        return this.update({ businessID, subject, ...(updatedFileds as any) } as any);
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
