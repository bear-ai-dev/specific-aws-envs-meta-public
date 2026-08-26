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
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { PodCostEntity } from '../cost/entities/podCost.entity.js';
import pickBy from 'lodash.pickby';
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
     * Settings updates are always partial updates, a caller only ever sends the fields it wants to
     * change. Every field which is not named on the request keeps the value the business already
     * had stored, while any field which is named is written, even when the value sent is empty
     * (clearing out an address line is a deliberate action, it is not the same as not sending it).
     * <br><br>
     * The same rule applies to the nested page configuration, naming one page (or one key of a
     * page's appearance) leaves everything else in that document untouched.
     */
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
        await this.manageComputeCostCollection({
            businessID,
            subject,
            previousComputeCostSource: existingSetting?.computeCostSource,
            newComputeCostSource: newEntity.computeCostSource,
        });
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    /**
     * The business profile screen only ever sends the handful of fields it owns, it is saved over
     * the same settings document, and follows the exact same partial update semantics.
     */
    async updateProfile({ businessID, subject, ...updatedFields }: UpdateProfileDto): Promise<ReadProfileResponse> {
        SettingsService.logger.log(`Updating business profile for business: ${businessID}`);
        const { data } = await this.update({ ...updatedFields, businessID, subject });
        const [setting] = data;
        return {
            message: 'Business profile updated successfully',
            data: [new ReadProfileResponseData(setting)],
        };
    }

    /**
     * Merges the fields a caller sent over the settings a business already has stored.
     * <br><br>
     * Fields which were not sent (undefined) are left alone, fields which were sent are written,
     * including empty values. Nested objects are merged key by key, arrays are replaced wholesale
     * since an array is always sent in full.
     */
    static mergeSettings(
        existingSetting: SettingsEntity,
        updatedFields: Partial<UpdateSettingsDto>,
    ): UpdateSettingsDto {
        const sentFields = pickBy({ ...updatedFields }, (value) => value !== undefined);
        return SettingsService.deepMerge({ ...existingSetting }, sentFields) as UpdateSettingsDto;
    }

    private static isMergeable(value: unknown): boolean {
        return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);
    }

    /**
     * Merges the values which were sent in over the values which are stored, one key at a time.
     * <br><br>
     * A key which was not sent (undefined) is never touched, a key which was sent is written even
     * when the value is empty, nested objects are merged recursively so naming one key of a nested
     * object leaves its siblings alone, and arrays replace whatever is stored as they are always
     * sent in full. Class instances (request DTOs, entities) are normalised to plain objects so the
     * merge is applied all the way down.
     */
    private static deepMerge(existingValues: Record<string, any>, sentValues: Record<string, any>) {
        const merged = { ...existingValues };
        Object.keys(sentValues).forEach((key) => {
            const sentValue = sentValues[key];
            if (sentValue === undefined) {
                // The caller never named this field, whatever is stored for it stays as it is.
                return;
            }
            if (sentValue === null) {
                // The caller explicitly unset this field, it is removed from the document so it
                // falls back to its default rather than keeping the value which was stored.
                delete merged[key];
                return;
            }
            const existingValue = merged[key];
            if (SettingsService.isMergeable(sentValue)) {
                merged[key] = SettingsService.deepMerge(
                    SettingsService.isMergeable(existingValue) ? { ...existingValue } : {},
                    sentValue,
                );
            } else {
                merged[key] = sentValue;
            }
        });
        return merged;
    }

    /**
     * Calculating compute costs from a business' own cluster only produces numbers while the hourly
     * collection behind it is running, so turning the source on enrolls the business in that
     * collection, turning it off unenrolls it, and restating the value already stored does neither.
     */
    private async manageComputeCostCollection({
        businessID,
        subject,
        previousComputeCostSource,
        newComputeCostSource,
    }: {
        businessID: string;
        subject: string;
        previousComputeCostSource: ComputeCostSource;
        newComputeCostSource: ComputeCostSource;
    }): Promise<void> {
        if (previousComputeCostSource === newComputeCostSource) {
            return;
        }
        try {
            if (newComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Enrolling business: ${businessID} in EKS compute cost collection`);
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
            } else if (previousComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Unenrolling business: ${businessID} from EKS compute cost collection`);
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
            }
        } catch (e) {
            // The settings themselves were saved, failing to (un)enroll the collection should not
            // fail the save, it is logged so it can be reconciled.
            SettingsService.logger.error(
                `Failed to manage compute cost collection for business: ${businessID}, error: ${JSON.stringify(
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
