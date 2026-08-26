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
import { serializeError } from 'serialize-error';

const isPlainMergeableObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Deeply merges the fields a caller explicitly sent (`updates`) on top of what is currently
 * stored (`base`).
 *
 * The rules are:
 * - A field which is not present, or present but `undefined`, in `updates` keeps the stored value.
 * - A field which is present in `updates` is written, even when the value sent is empty
 *   (an empty string, `false`, or `0`) since clearing a field is a deliberate action and is not the
 *   same as never having sent it.
 * - A field sent as `null` is removed from the document, so it falls back to its default.
 * - Nested objects are merged recursively so only the named leaves change.
 * - Arrays are replaced wholesale, they are treated as a single value.
 *
 * @param base the currently stored document
 * @param updates the fields the caller named on this request
 * @returns a new plain object, neither argument is mutated
 */
export const deepMergeDefinedFields = <T>(
    base: Partial<T> = {} as Partial<T>,
    updates: Partial<T> = {} as Partial<T>,
): T => {
    const merged = {} as Record<string, unknown>;
    const storedFields = (base ?? {}) as Record<string, unknown>;
    const requestedFields = (updates ?? {}) as Record<string, unknown>;

    Object.keys(storedFields).forEach((key) => {
        const currentValue = storedFields[key];
        merged[key] = isPlainMergeableObject(currentValue) ? deepMergeDefinedFields(currentValue) : currentValue;
    });

    Object.keys(requestedFields).forEach((key) => {
        const incomingValue = requestedFields[key];
        // A field the caller never named must not disturb what is stored.
        if (incomingValue === undefined) {
            return;
        }
        // A field sent as null is removed, so it falls back to its default.
        if (incomingValue === null) {
            delete merged[key];
            return;
        }
        const currentValue = merged[key];
        if (isPlainMergeableObject(incomingValue)) {
            merged[key] = deepMergeDefinedFields(
                isPlainMergeableObject(currentValue) ? currentValue : {},
                incomingValue,
            );
        } else {
            merged[key] = incomingValue;
        }
    });

    return merged as T;
};

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
     * Updates the settings document for a business as a partial update.
     * <br><br>
     * Only the fields present on the request are written, every other field keeps the value the
     * business already had stored. A field which is present is written even when the value sent is
     * empty, clearing a field is a deliberate action and is not the same as never sending it.
     * Nested objects, such as the portal `pages` configuration, are merged the same way so naming
     * one page, or one entry of a page's appearance, leaves the rest of the document untouched.
     * A field sent as `null` is removed from the document and falls back to its default.
     * <br><br>
     * Turning the compute cost source on, or off, travels with the save: the hourly collection which
     * produces those figures is started, or wound down, as part of the update.
     */
    async update({
        businessID,
        subject,
        ...updatedFields
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFields));
        const { loadPoints } = this.InfluxService;
        const storedSetting = await this.findLatestSetting({ businessID });
        const mergedFields = deepMergeDefinedFields<UpdateSettingsDto>(
            { ...storedSetting } as UpdateSettingsDto,
            updatedFields as UpdateSettingsDto,
        );
        const newEntity = new SettingsEntity({
            ...mergedFields,
            businessID,
        });
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        await this.manageComputeCostCollection({
            businessID,
            subject,
            storedComputeCostSource: storedSetting.computeCostSource,
            updatedComputeCostSource: newEntity.computeCostSource,
        });
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    /**
     * Updates the fields shown on the business profile screen, over the same settings document, with
     * the same partial update behaviour as {@link SettingsService.update}.
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

    /**
     * Compute costs derived from a business' own cluster are only produced while the hourly
     * collection behind them is running, so turning the source on has to start that collection and
     * turning it off has to wind it down. A save which restates the source the business already had
     * does neither.
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
                SettingsService.logger.log(`Enrolling business: ${businessID} in hourly compute cost collection`);
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
            } else if (storedComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Unenrolling business: ${businessID} from hourly compute cost collection`);
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
            }
        } catch (error) {
            // The settings document has already been written, a scheduling problem should not fail the save.
            SettingsService.logger.error(
                `Failed to manage the compute cost collection for business: ${businessID}, error: ${JSON.stringify(
                    serializeError(error),
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
}
