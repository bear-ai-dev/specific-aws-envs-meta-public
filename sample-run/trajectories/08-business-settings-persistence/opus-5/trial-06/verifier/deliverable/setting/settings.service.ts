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

    /**
     * Determines if a value can be recursively merged, meaning it is a non null object
     * that is not an array or a date. Arrays and primitives are always replaced wholesale.
     */
    private static isMergeable(value: unknown): boolean {
        return (
            typeof value === 'object' &&
            value !== null &&
            !Array.isArray(value) &&
            !(value instanceof Date) &&
            !Buffer.isBuffer(value)
        );
    }

    /**
     * Merges the fields sent by the caller on top of what is currently stored for the business.
     * <br><br>
     * Fields which were not sent (`undefined`) keep their stored value, fields which were sent are
     * written even when they are blank (an empty string is an intentional erasure). Nested objects,
     * such as the portal `pages` configuration, are merged key by key so naming a single page, or a
     * single appearance value, leaves its siblings untouched.
     */
    static mergeSettingFields<T>(storedValue: T, updatedValue: unknown): T | unknown {
        // The caller did not name this field, keep whatever is stored.
        if (updatedValue === undefined) {
            return storedValue;
        }
        if (!SettingsService.isMergeable(updatedValue) || !SettingsService.isMergeable(storedValue)) {
            return updatedValue;
        }
        const merged = { ...(storedValue as Record<string, unknown>) };
        Object.keys(updatedValue as Record<string, unknown>).forEach((key) => {
            const value = (updatedValue as Record<string, unknown>)[key];
            if (value === undefined) {
                // Field was not named on the request, the stored value survives.
                return;
            }
            merged[key] = SettingsService.mergeSettingFields(merged[key], value);
        });
        return merged;
    }

    async update({
        businessID,
        subject,
        ...updatedFileds
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFileds));
        const { loadPoints } = this.InfluxService;
        const currentSetting = await this.findLatestSetting({ businessID });
        const mergedFields = SettingsService.mergeSettingFields(
            { ...currentSetting },
            updatedFileds,
        ) as UpdateSettingsDto;
        const newEntity = new SettingsEntity({
            ...mergedFields,
            businessID,
        });
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        await this.manageComputeCostCollection({
            businessID,
            subject,
            previousComputeCostSource: currentSetting.computeCostSource,
            currentComputeCostSource: newEntity.computeCostSource,
        });
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    /**
     * The compute cost source only produces data while the hourly collection behind it runs, so
     * enabling it has to start that collection and disabling it has to stop it. Restating the value
     * that is already stored is a no-op.
     */
    private async manageComputeCostCollection({
        businessID,
        subject,
        previousComputeCostSource,
        currentComputeCostSource,
    }: {
        businessID: string;
        subject?: string;
        previousComputeCostSource?: ComputeCostSource;
        currentComputeCostSource?: ComputeCostSource;
    }): Promise<void> {
        if (previousComputeCostSource === currentComputeCostSource) {
            return;
        }
        try {
            if (currentComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Enrolling business ${businessID} in hourly compute cost collection`);
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
            } else if (previousComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Unenrolling business ${businessID} from hourly compute cost collection`);
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
            }
        } catch (e) {
            // The setting itself is saved, a scheduling problem should not fail the save.
            SettingsService.logger.error(
                `Failed to manage the compute cost collection for business ${businessID}: ${e?.message}`,
                e?.stack,
            );
        }
    }

    async fileUpload({ file, businessID }: FileUploadDto): Promise<BasicResponseDTO> {
        const invoiceImageBucket = `meteringco-${process.env.STAGE}-brand-images`;
        const uuid = randomUUID();
        const imageKey = `${businessID}-invoice-image-${uuid}`;
        await putDocument(file, invoiceImageBucket, imageKey).done();
        this.update({
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

    /**
     * Saves the fields shown on the business profile screen over the same settings document, keeping
     * every field the caller did not name at its stored value.
     */
    async updateProfile({ businessID, subject, ...profileFields }: UpdateProfileDto): Promise<ReadProfileResponse> {
        SettingsService.logger.log(`Updating business profile for business: ${businessID}`);
        const {
            data: [setting],
        } = await this.update({ ...profileFields, businessID, subject });
        return {
            message: 'Business profile updated successfully',
            data: [new ReadProfileResponseData(setting)],
        };
    }
}
