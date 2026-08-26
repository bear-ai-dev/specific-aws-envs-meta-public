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
import { mergeDefined } from '../utils/mergeDefined.js';
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
     * Updates the settings document of a business with the fields named by the caller.
     * <br><br>
     * The update is a merge over the currently stored document: fields (and nested fields) the caller left out keep
     * the value the business already had stored, while every field the caller did send is written, even when the
     * value sent is empty. Turning the compute cost source on or off also starts / stops the hourly collection that
     * backs it.
     */
    async update({
        businessID,
        subject,
        ...updatedFileds
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFileds));
        const { loadPoints } = this.InfluxService;
        // Everything the business already has stored, so a partial update never drops a field it did not name.
        const storedSetting = await this.findLatestSetting({ businessID });
        const mergedFields = mergeDefined({ ...storedSetting }, updatedFileds);
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
            storedComputeCostSource: storedSetting.computeCostSource,
            updatedComputeCostSource: newEntity.computeCostSource,
        });
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    /**
     * Compute costs calculated from the cluster of a business only produce figures while the hourly collection
     * behind them runs. Enabling the source enrolls the business into that collection, disabling it unenrolls the
     * business, and restating the value already stored does neither.
     */
    private async manageComputeCostCollection({
        businessID,
        subject,
        storedComputeCostSource,
        updatedComputeCostSource,
    }: {
        businessID: string;
        subject?: string;
        storedComputeCostSource?: ComputeCostSource;
        updatedComputeCostSource?: ComputeCostSource;
    }): Promise<void> {
        if (storedComputeCostSource === updatedComputeCostSource) {
            return;
        }
        try {
            if (updatedComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Enrolling business: ${businessID} into hourly compute cost collection`);
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
            } else if (storedComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Unenrolling business: ${businessID} from hourly compute cost collection`);
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
            }
        } catch (e) {
            // The settings document is already saved, failing to (un)schedule the collection should not undo it.
            SettingsService.logger.error(
                `Failed to manage the hourly compute cost collection for business: ${businessID}`,
                serializeError(e),
            );
        }
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

    /**
     * Saves the field set of the business profile screen over the same settings document.
     * <br><br>
     * Behaves exactly like {@link SettingsService.update}: only the fields named on the request are written,
     * everything else the business has stored is kept.
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
