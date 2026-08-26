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

function isPlainObject(obj: any): boolean {
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

function deepMerge(target: any, source: any): any {
    if (!isPlainObject(target) && !isPlainObject(source)) {
        return source !== undefined ? source : target;
    }
    const result: any = { ...target };
    if (!isPlainObject(source)) {
        return result;
    }
    for (const key of Object.keys(source)) {
        const srcVal = source[key];
        if (srcVal === undefined) {
            continue;
        }
        const tgtVal = target ? target[key] : undefined;
        if (isPlainObject(srcVal) && isPlainObject(tgtVal)) {
            result[key] = deepMerge(tgtVal, srcVal);
        } else {
            result[key] = srcVal;
        }
    }
    return result;
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

    async update({
        businessID,
        subject,
        ...updatedFields
    }: UpdateSettingsDto): Promise<{ data: ReadSettingsResponseData[]; message: string }> {
        SettingsService.logger.log('Updating platform settings');
        SettingsService.logger.log(JSON.stringify(updatedFields));
        const oldEntity = await this.findLatestSetting({ businessID });

        // Build merged object: start from oldEntity, overlay defined fields
        const merged: any = { businessID };

        // List all possible fields from SettingsEntity / UpdateSettingsDto
        const allFields = [
            'businessName',
            'taxRate',
            'addressLine1',
            'addressLine2',
            'city',
            'state',
            'country',
            'postalCode',
            'vatId',
            'invoicePaymentTerm',
            'customFields',
            'logoUrl',
            'taxCategory',
            'taxCalculationType',
            'stripeAccountId',
            'cloudIAM',
            'computeCostSource',
            'storageCostSource',
            'archiveCostSource',
            'stripeConnected',
            'taxJarApiKey',
            'accountState',
            'pages',
            'invoiceApproval',
            'freeDimensionOnInvoice',
            'invoiceGeneration',
            'supportEmail',
            'sendInvoiceEmail',
            'redirectionUrl',
        ] as const;

        for (const field of allFields) {
            const incoming: any = (updatedFields as any)[field];
            if (incoming !== undefined) {
                if (field === 'pages') {
                    const oldPagesPlain = oldEntity.pages ? JSON.parse(JSON.stringify(oldEntity.pages)) : new PortalPages() as any;
                    // deep merge pages
                    merged[field] = deepMerge(oldPagesPlain, incoming);
                } else if (field === 'cloudIAM') {
                    const oldCloud = (oldEntity as any)[field] ? JSON.parse(JSON.stringify((oldEntity as any)[field])) : {};
                    merged[field] = deepMerge(oldCloud, incoming);
                } else {
                    merged[field] = incoming;
                }
            } else {
                merged[field] = (oldEntity as any)[field];
            }
        }

        const newEntity = new SettingsEntity(merged);

        // Handle compute cost source scheduler side effect
        const oldSource = oldEntity.computeCostSource;
        const newSource = newEntity.computeCostSource;
        if (oldSource !== newSource) {
            if (newSource === ComputeCostSource.eks) {
                try {
                    await PodCostEntity.enroll(this.schedulerService, { businessID, subject: subject || '' });
                } catch (e) {
                    SettingsService.logger.error('Failed to enroll compute cost scheduler', e);
                }
            } else if (oldSource === ComputeCostSource.eks) {
                try {
                    await PodCostEntity.unenroll(this.schedulerService, { businessID, subject: subject || '' });
                } catch (e) {
                    SettingsService.logger.error('Failed to unenroll compute cost scheduler', e);
                }
            }
        }

        const { loadPoints } = this.InfluxService;
        const dbModel = SettingsEntity.transformer(newEntity, this.InfluxService);
        const responseDto = new ReadSettingsResponseData(newEntity);
        // The cache consequence must travel with the save rather than sit beside it – do them together
        await Promise.all([
            loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, dbModel),
            cacheManager.set(businessID, JSON.stringify(responseDto), 604800),
        ]);
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
        ...updatedFields
    }: any): Promise<{ data: ReadProfileResponseData[]; message: string }> {
        // Reuse same merge behaviour but via update; this allows profile screen to save its field set over same document
        const result = await this.update({ businessID, subject, ...updatedFields } as UpdateSettingsDto);
        const profileData = result.data.map((d) => new ReadProfileResponseData(d as any));
        return { data: profileData, message: 'Profile updated successfully' };
    }
}
