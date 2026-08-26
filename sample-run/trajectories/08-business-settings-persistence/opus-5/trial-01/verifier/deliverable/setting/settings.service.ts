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
import { deepMergeDefined } from '../utils/shared/deepMerge.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { serializeError } from 'serialize-error';

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
        return new SettingsEntity({ businessID, pages: PortalPages.withDefaults() });
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
        const { loadPoints } = this.InfluxService;
        // Settings are updated one screen at a time, each screen only sends the fields it owns.
        // Merge what was sent over what is stored so that untouched fields are never reset.
        const currentSetting = await this.findLatestSetting({ businessID });
        const mergedFields = deepMergeDefined({ ...currentSetting }, updatedFileds);
        const newEntity = new SettingsEntity({
            ...mergedFields,
            businessID,
        });
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        // The hourly compute cost gathering must follow the setting it belongs to
        await this.manageComputeCostGathering({
            businessID,
            subject,
            currentComputeCostSource: currentSetting?.computeCostSource,
            updatedComputeCostSource: newEntity?.computeCostSource,
        });
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    /**
     * Compute costs calculated from a business' own cluster are only produced while the hourly
     * gathering job behind them is running. Enroll, or unenroll, the business from that job when, and
     * only when, the setting actually changes.
     */
    private async manageComputeCostGathering({
        businessID,
        subject,
        currentComputeCostSource,
        updatedComputeCostSource,
    }: {
        businessID: string;
        subject?: string;
        currentComputeCostSource?: ComputeCostSource;
        updatedComputeCostSource?: ComputeCostSource;
    }): Promise<void> {
        if (currentComputeCostSource === updatedComputeCostSource) {
            SettingsService.logger.debug(
                `Compute cost source unchanged for business: ${businessID}, no scheduling change needed`,
            );
            return;
        }
        try {
            if (updatedComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Enrolling business: ${businessID} in compute cost gathering`);
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
            } else if (currentComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Unenrolling business: ${businessID} from compute cost gathering`);
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
            }
        } catch (e) {
            // A scheduling problem should not stop a business from saving their settings
            SettingsService.logger.error(
                `Failed to manage compute cost gathering for business: ${businessID}, error: ${JSON.stringify(
                    serializeError(e),
                )}`,
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
     * Updates the business profile, over the same document the rest of the settings live in.
     * <br><br>
     * The profile screen only sends the fields it owns, so only the fields sent in are written,
     * everything else the business has stored, settings included, is left exactly as it was.
     */
    async updateProfile({
        businessID,
        subject,
        ...updatedFields
    }: UpdateProfileDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log(`Updating business profile for business: ${businessID}`);
        return this.update({ businessID, subject, ...updatedFields });
    }
}
