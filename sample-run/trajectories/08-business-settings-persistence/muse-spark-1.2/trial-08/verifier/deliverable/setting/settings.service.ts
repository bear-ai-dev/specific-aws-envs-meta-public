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
import { UpdateProfileDto } from './dto/update-profile.dto.js';

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

    private isPlainObject(obj: any): boolean {
        return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
    }

    private deepMerge(target: any, source: any): any {
        if (source === undefined) return target;
        if (!this.isPlainObject(source)) return source;
        const result: any = { ...(target || {}) };
        for (const key of Object.keys(source)) {
            const srcVal = (source as any)[key];
            if (srcVal === undefined) continue;
            const tgtVal = (result as any)[key];
            if (this.isPlainObject(srcVal) && this.isPlainObject(tgtVal)) {
                (result as any)[key] = this.deepMerge(tgtVal, srcVal);
            } else {
                (result as any)[key] = srcVal;
            }
        }
        return result;
    }

    private mergeSettings(existing: SettingsEntity, updated: Record<string, any>): Record<string, any> {
        const merged: any = { ...existing };
        for (const key of Object.keys(updated)) {
            const val = (updated as any)[key];
            if (val === undefined) continue;
            const existingVal = (existing as any)[key];
            if ((key === 'pages' || key === 'cloudIAM') && this.isPlainObject(val) && this.isPlainObject(existingVal)) {
                merged[key] = this.deepMerge(existingVal, val);
            } else if (this.isPlainObject(val) && this.isPlainObject(existingVal)) {
                merged[key] = this.deepMerge(existingVal, val);
            } else {
                merged[key] = val;
            }
        }
        return merged;
    }

    async update({
        businessID,
        subject,
        ...updatedFields
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFields));

        const existing = await this.findLatestSetting({ businessID });
        const mergedFields = this.mergeSettings(existing, updatedFields as Record<string, any>);

        // Handle computeCostSource scheduler side-effect - must travel with save
        const incomingCompute = (updatedFields as any).computeCostSource;
        if (incomingCompute !== undefined) {
            const existingCompute = existing.computeCostSource;
            const newCompute = (mergedFields as any).computeCostSource;
            if (newCompute !== existingCompute) {
                try {
                    if (newCompute === ComputeCostSource.eks && existingCompute !== ComputeCostSource.eks) {
                        await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
                    } else if (existingCompute === ComputeCostSource.eks && newCompute === ComputeCostSource.none) {
                        await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
                    }
                } catch (e) {
                    // If unenrolling and job not found, treat as already wound down; for enroll, if already exists, treat as success
                    const isNotFound = e?.status === 404 || e?.message?.includes('not found') || e?.message?.includes('Not Found');
                    if (isNotFound) {
                        SettingsService.logger.warn(`Scheduler job not found during computeCostSource transition, ignoring: ${e?.message}`);
                    } else {
                        SettingsService.logger.error('Failed to update compute cost scheduler', e?.stack || e);
                        throw e;
                    }
                }
            }
        }

        const newEntity = new SettingsEntity({
            ...mergedFields,
            businessID,
        } as any);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    async updateProfile({
        businessID,
        subject,
        ...updatedFields
    }: UpdateProfileDto): Promise<ReadProfileResponse> {
        SettingsService.logger.log('Updating business profile');
        SettingsService.logger.log(JSON.stringify(updatedFields));
        const existing = await this.findLatestSetting({ businessID });
        const mergedFields = this.mergeSettings(existing, updatedFields as Record<string, any>);
        const newEntity = new SettingsEntity({
            ...mergedFields,
            businessID,
        } as any);
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await this.InfluxService.loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        const fullResponseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(fullResponseDto), 604800);
        const profileDto = new ReadProfileResponseData(newEntity);
        return { message: 'Business profile updated successfully', data: [profileDto] };
    }

    async fileUpload({ file, businessID }: FileUploadDto): Promise<BasicResponseDTO> {
        const invoiceImageBucket = `meteringco-${process.env.STAGE}-brand-images`;
        const uuid = randomUUID();
        const imageKey = `${businessID}-invoice-image-${uuid}`;
        await putDocument(file, invoiceImageBucket, imageKey).done();
        await this.update({
            businessID,
            logoUrl: `https://meteringco-${process.env.STAGE}-brand-images.s3.amazonaws.com/${businessID}-invoice-image-${uuid}`,
        } as any);

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
