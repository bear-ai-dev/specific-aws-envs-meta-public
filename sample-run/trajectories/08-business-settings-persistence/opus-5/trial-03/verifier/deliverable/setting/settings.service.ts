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
     * Deep merges the values of `updatedFields` on top of `existingFields`.
     * <br>
     * - A field that was not sent in (`undefined`) keeps the value it has in `existingFields`.
     * - A field that was sent in is taken as is, even when it is empty (`''`), emptying a field is an explicit
     *   action and is not the same as not sending the field at all.
     * - A field that was sent in as `null` is unset, it is removed from the document.
     * - Nested objects are merged the same way, recursively, so naming one key of a nested object leaves
     *   its siblings alone.
     * - Arrays and everything that is not a plain value bag are replaced, they are always sent in full.
     */
    private static deepMergeDefined<T>(existingFields: T, updatedFields: Partial<T>): T {
        const isMergeable = (value: unknown): boolean =>
            typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

        const merged = { ...existingFields } as T;
        Object.entries(updatedFields ?? {}).forEach(([key, updatedValue]) => {
            if (updatedValue === undefined) {
                // The caller did not send this field, keep whatever is stored for the business.
                return;
            }
            if (updatedValue === null) {
                // The caller explicitly unset this field.
                delete merged[key];
                return;
            }
            const existingValue = merged[key];
            if (isMergeable(updatedValue) && isMergeable(existingValue)) {
                merged[key] = SettingsService.deepMergeDefined(existingValue, updatedValue);
            } else if (isMergeable(updatedValue)) {
                merged[key] = SettingsService.deepMergeDefined({}, updatedValue);
            } else {
                merged[key] = updatedValue;
            }
        });
        return merged;
    }

    /**
     * Merges the fields sent in on a settings update with what is already stored for the business.
     * <br>
     * Settings are stored as a single document while every screen of the console only sends the fields it owns,
     * therefore an update has to behave like a patch, see {@link SettingsService.deepMergeDefined}. This holds for
     * the nested portal `pages` configuration too: naming one page leaves the other pages exactly as they were and
     * naming one entry of a page's `appearance` leaves the rest of that block alone.
     */
    private static mergeSettings(
        existingSetting: SettingsEntity,
        updatedFields: Omit<UpdateSettingsDto, 'businessID' | 'subject'>,
    ): UpdateSettingsDto {
        return SettingsService.deepMergeDefined(existingSetting as UpdateSettingsDto, updatedFields);
    }

    /**
     * Compute costs calculated off of a customers own cluster are gathered by an hourly schedule,
     * therefore turning the source on and off has to start and stop that schedule as part of the same save.
     */
    private async manageComputeCostCollection({
        businessID,
        subject,
        previousComputeCostSource,
        updatedComputeCostSource,
    }: {
        businessID: string;
        subject?: string;
        previousComputeCostSource?: ComputeCostSource;
        updatedComputeCostSource?: ComputeCostSource;
    }): Promise<void> {
        if (!updatedComputeCostSource || updatedComputeCostSource === previousComputeCostSource) {
            // Nothing was requested, or the request restates what is already stored, so there is nothing to do.
            return;
        }
        try {
            if (updatedComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Enrolling ${businessID} into compute cost gathering`);
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
            } else {
                SettingsService.logger.log(`Unenrolling ${businessID} from compute cost gathering`);
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
            }
        } catch (e) {
            SettingsService.logger.error(
                `Failed to manage the compute cost schedule for ${businessID}: ${e?.message}`,
                e?.stack,
            );
        }
    }

    async update({
        businessID,
        subject,
        ...updatedFileds
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFileds));
        const { loadPoints } = this.InfluxService;
        const existingSetting = await this.findLatestSetting({ businessID });
        const newEntity = new SettingsEntity({
            ...SettingsService.mergeSettings(existingSetting, updatedFileds),
            businessID,
        });
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        await this.manageComputeCostCollection({
            businessID,
            subject,
            previousComputeCostSource: existingSetting.computeCostSource,
            updatedComputeCostSource: updatedFileds.computeCostSource,
        });
        return { data: [responseDto], message: 'Setting updated successfully' };
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
     * Updates the business profile, this is the same document as the rest of the settings,
     * only the fields of the profile screen are accepted and it behaves exactly like a settings update.
     */
    async updateProfile({ businessID, subject, ...updatedFields }: UpdateProfileDto): Promise<ReadProfileResponse> {
        SettingsService.logger.log(`Updating business profile for business: ${businessID}`);
        const {
            data: [setting],
        } = await this.update({ ...updatedFields, businessID, subject });
        return {
            message: 'Business profile updated successfully',
            data: [new ReadProfileResponseData(setting)],
        };
    }
}
