import { forwardRef, Inject, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ComputeCostSource, PortalPages, UpdateSettingsDto } from './dto/update-settings.dto.js';
import { InfluxService } from '../influx/influx.service.js';
import { SettingsEntity, StripeConnected } from './entities/settings.entity.js';
import { ReadProfileResponse, ReadProfileResponseData, ReadSettingsResponseData } from './dto/read-setting.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { mergeDefinedFields } from '../utils/mergeDefinedFields.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { PodCostEntity } from '../cost/entities/podCost.entity.js';
import { serializeError } from 'serialize-error';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
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
        // Settings updates are partial updates: everything the caller left out has to keep the
        // value the business already had stored, while everything the caller did send is written,
        // even when the value sent is blank. This holds for the nested page configuration too.
        const currentSettings = await this.findLatestSetting({ businessID });
        const mergedSettings = mergeDefinedFields<UpdateSettingsDto>({ ...currentSettings }, updatedFileds);
        const newEntity = new SettingsEntity({
            ...mergedSettings,
            businessID,
        });
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel);
        await this.reconcileComputeCostCollection({
            businessID,
            subject,
            previousComputeCostSource: currentSettings.computeCostSource,
            computeCostSource: newEntity.computeCostSource,
        });
        const responseDto = new ReadSettingsResponseData(newEntity);
        await cacheManager.set(businessID, JSON.stringify(responseDto), 604800);
        return { data: [responseDto], message: 'Setting updated successfully' };
    }

    /**
     * Updating the profile screen writes to the very same settings document, with the same
     * partial update semantics as a full settings update.
     */
    async updateProfile({
        businessID,
        subject,
        ...updatedFields
    }: UpdateProfileDto & { businessID?: string; subject?: string }): Promise<ReadProfileResponse> {
        SettingsService.logger.log(`Updating business profile for business: ${businessID}`);
        const { data } = await this.update({ ...updatedFields, businessID, subject });
        return {
            message: 'Business profile updated successfully',
            data: [new ReadProfileResponseData(data[0])],
        };
    }

    /**
     * Computing costs from a business' own cluster only produces figures while the hourly
     * collection behind it runs, so turning the source on has to start that collection and
     * turning it off has to wind it down. Restating the value already stored changes nothing.
     */
    private async reconcileComputeCostCollection({
        businessID,
        subject,
        previousComputeCostSource,
        computeCostSource,
    }: {
        businessID: string;
        subject?: string;
        previousComputeCostSource?: ComputeCostSource;
        computeCostSource?: ComputeCostSource;
    }): Promise<void> {
        if (previousComputeCostSource === computeCostSource) {
            return;
        }
        try {
            if (computeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Enrolling business ${businessID} in hourly compute cost collection`);
                await PodCostEntity.enroll(this.schedulerService, { businessID, subject });
            } else if (previousComputeCostSource === ComputeCostSource.eks) {
                SettingsService.logger.log(`Unenrolling business ${businessID} from hourly compute cost collection`);
                await PodCostEntity.unenroll(this.schedulerService, { businessID, subject });
            }
        } catch (e) {
            SettingsService.logger.error(
                `Failed to reconcile the hourly compute cost collection for business ${businessID}: ${JSON.stringify(
                    serializeError(e),
                )}`,
            );
            AuditService.publishEvent({
                data: [serializeError(e), { businessID, previousComputeCostSource, computeCostSource }],
                message: 'Failed to reconcile the compute cost collection schedule',
                topic: AuditScope.ERROR,
            });
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
