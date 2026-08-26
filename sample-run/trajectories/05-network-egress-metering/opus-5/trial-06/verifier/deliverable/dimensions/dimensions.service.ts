import {
    BadRequestException,
    ConflictException,
    forwardRef,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InfluxService } from '../influx/influx.service.js';
import {
    CreateDimensionResponse,
    SampleType,
    aggregationInterval,
    aggregationMethod,
    infrastructureType,
    UpdateDimensionResponse,
    overageAllowedEnum,
    PaymentSchedule,
    CreateDimensionDto,
    ReadDimensionResponseData,
} from './dto/create-dimension.dto.js';

import { DeleteDimensionDto, DeleteDimensionResponseDto } from './dto/deleteDimension.dto.js';
import { ReadDimensionDto, ReadDimensionResponse } from './dto/read-dimension.dto.js';
import { v4 } from 'uuid';
import { DimensionEntity, numericalType } from './entities/dimensions.entity.js';
import { BasicResponseDTO } from '../basicResponseDTO.js';
import { UpdateDimensionDto } from './dto/update-dimension.dto.js';
import { MeasurementConfigService } from '../measurement-config/measurement-config.service.js';
import { OfferingService } from '../offering/offering.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import {
    AgentAccessInformation,
    InfrastructureAccessInformation,
    SupportedResources,
} from '../measurement-config/entities/measurement-config.entity.js';
import { schedulerType, SchedulerStatus, SupportedMeasurementFrequencies } from '../scheduler/dto/scheduler.dto.js';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { measurementMode } from '../measurement-config/dto/create-measurement-config.dto.js';
import { joinMetadataObjectsAndRemoveNulls } from '../utils/shared/utils.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { TokenType } from '../token-consumer/dto/TokenType.js';
import { serializeError } from 'serialize-error';

@Injectable()
export class DimensionsService {
    private static readonly logger = new Logger(DimensionsService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => MeasurementConfigService)) readonly measurementConfigService: MeasurementConfigService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
    ) {}
    async create(createDimensionDto: CreateDimensionDto, subject): Promise<CreateDimensionResponse> {
        const dimensionId = v4();
        // create the Points and commit it
        const { loadPoints } = this.InfluxService;
        const { measurementId, businessID } = createDimensionDto;
        let inputForEntity;
        if (measurementId) {
            inputForEntity = await this.measurementConfigService.createMeasurementConfig(
                createDimensionDto,
                measurementId,
                createDimensionDto.businessID,
                dimensionId,
            );
        } else {
            inputForEntity = this.transformDtoToEntityInput(createDimensionDto, dimensionId);
        }
        DimensionsService.logger.debug(`Input for Entity`, JSON.stringify(inputForEntity));
        const dimensionModel = new DimensionEntity(inputForEntity);
        const dbModel = DimensionEntity.transformer(dimensionModel, this.InfluxService);

        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, [dbModel]);

        if (measurementId) {
            const {
                data: [{ measurementMode: argumentMeasurementMode, measurementConfiguration }],
            } = await this.measurementConfigService.findOne({ measurementId, businessID });
            if (argumentMeasurementMode === measurementMode.infrastructureBased) {
                const accessInformation = measurementConfiguration as InfrastructureAccessInformation;
                await this.schedulerService.create({
                    schedulerID: this.createKeyForManagedInfraDimensionSchedule({
                        dimensionId,
                        resourceType: accessInformation.resourceType,
                    }),
                    schedulerType: schedulerType.dimensionDataGathering,
                    schedulerStatus: SchedulerStatus.live,
                    scheduleParameters: {
                        dimensionType: this.ressourceTypeToDimensionType(accessInformation.resourceType),
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        //@ts-ignore
                        dimensionId,
                        businessID,
                        rate: SupportedMeasurementFrequencies.everyFiveMinutes,
                        iamRoleArn: accessInformation?.iamRoleArn,
                        externalId: accessInformation?.externalId,
                        region: accessInformation?.region,
                    },
                    rate: SupportedMeasurementFrequencies.everyFiveMinutes,
                    subject,
                    businessID,
                });
            } else if (argumentMeasurementMode === measurementMode.agentBased) {
                const accessInformation = measurementConfiguration as AgentAccessInformation;
                await this.schedulerService.create({
                    schedulerID: this.createKeyForManagedInfraDimensionSchedule({
                        dimensionId,
                        resourceType: accessInformation.hostingPlatform,
                    }),
                    schedulerType: schedulerType.dimensionDataGathering,
                    schedulerStatus: SchedulerStatus.live,
                    scheduleParameters: {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        //@ts-ignore
                        dimensionType: this.ressourceTypeToDimensionType(infrastructureType.podCPUHours),
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        //@ts-ignore
                        dimensionId,
                        businessID,
                        rate: SupportedMeasurementFrequencies.everyHour,
                        iamRoleArn: accessInformation?.iamRoleArn,
                        externalId: accessInformation?.externalId,
                    },
                    rate: SupportedMeasurementFrequencies.everyHour,
                    subject,
                    businessID,
                });
                await this.schedulerService.create({
                    schedulerID: this.createKeyForManagedInfraDimensionSchedule({
                        dimensionId,
                        resourceType: `${accessInformation.hostingPlatform}-${infrastructureType.reservedInstanceHours}`,
                    }),
                    schedulerType: schedulerType.dimensionDataGathering,
                    schedulerStatus: SchedulerStatus.live,
                    scheduleParameters: {
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        //@ts-ignore
                        dimensionType: infrastructureType.reservedInstanceHours,
                        iamRoleArn: accessInformation?.iamRoleArn,
                        externalId: accessInformation?.externalId,
                    },
                    rate: SupportedMeasurementFrequencies.everyHour,
                    subject,
                    businessID,
                });
            }
        }
        try {
            await this.tokenConsumerService.create({
                subject,
                businessID,
                tokenAmount: '1',
                metadata: {
                    tokenType: TokenType.metric,
                },
            });
        } catch (e) {
            DimensionsService.logger.error('Failed to meter token for metric', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to meter token for customer',
                data: [{ dimensionId, businessID, error: serializeError(e) }],
            });
        }
        return { message: 'created dimension document', dimensionId };
    }
    private createKeyForManagedInfraDimensionSchedule({ dimensionId, resourceType }) {
        return `${dimensionId}-${resourceType}`;
    }
    private ressourceTypeToDimensionType(ressourceType: SupportedResources): infrastructureType {
        const normalizedResourceType = ressourceType ? `${ressourceType}`.toLowerCase() : ressourceType;
        if (normalizedResourceType === SupportedResources.ebssnapshot.toLowerCase()) {
            return infrastructureType.ebsSnapshot;
        }
        if (normalizedResourceType === SupportedResources.ebs.toLowerCase()) {
            return infrastructureType.ebsVolumeProvisionedCapacity;
        }
        if (normalizedResourceType === SupportedResources.k8sPod.toLowerCase()) {
            return infrastructureType.podCPUHours;
        }
        if (normalizedResourceType === SupportedResources.ec2.toLowerCase()) {
            return infrastructureType.instanceRunningTime;
        }
        if (normalizedResourceType === SupportedResources.ec2NetworkOut.toLowerCase()) {
            return infrastructureType.ec2NetworkOut;
        }
    }

    async findAll({ businessID }): Promise<ReadDimensionResponse> {
        const results = await this.InfluxService.getAllDimensions({ businessID });
        const { data: measurementData } = await this.measurementConfigService.findAll({ businessID });
        const measurementMap = measurementData.reduce((acc, item) => {
            acc[item.measurementId] = item;
            return acc;
        }, {});

        if (results && results.length && results.length > 0) {
            return {
                data: results.map((res) => {
                    const entity = DimensionEntity.dbModelToEntity(res);
                    const { measurementId, ...rest } = new CreateDimensionDto(entity);
                    let measurement;
                    if (measurementId) {
                        measurement = measurementMap[measurementId];
                        if (!measurement) {
                            AuditService.publishEvent({
                                message: 'Measurement not found for dimension in find all',
                                data: [{ dimensionId: entity.dimensionId, measurementId: entity.measurementId }],
                                topic: AuditScope.ERROR,
                            });
                        }
                    }
                    return {
                        dimensionId: entity.dimensionId,
                        ...rest,
                        ...(measurement && { measurement: { ...measurement } }),
                    };
                }),
                message: 'Found Dimensions',
            };
        } else {
            return { data: [], message: 'No Dimensions found' };
        }
    }

    async findOne({
        businessID,
        dimensionId,
    }: ReadDimensionDto): Promise<{ data: ReadDimensionResponseData[]; message: string }> {
        const { getSingleDimension } = this.InfluxService;
        const dbModel = await getSingleDimension({ businessID, dimensionId });
        if (dbModel.length) {
            const entity = DimensionEntity.dbModelToEntity(dbModel[0]);
            let measurementData;
            if (entity?.measurementId) {
                try {
                    const {
                        data: [measurementInfo],
                    } = await this.measurementConfigService.findOne({
                        measurementId: entity.measurementId,
                        businessID,
                    });
                    measurementData = measurementInfo;
                } catch (error) {
                    if (error instanceof NotFoundException) {
                        AuditService.publishEvent({
                            message: 'Measurement not found for dimension',
                            data: [{ dimensionId, measurementId: entity.measurementId }],
                            topic: AuditScope.ERROR,
                        });
                    } else {
                        throw error;
                    }
                }
            }
            const { measurementId, ...rest } = new CreateDimensionDto(entity);

            return {
                data: [
                    {
                        dimensionId: entity.dimensionId,
                        ...rest,
                        ...(measurementData && { measurement: { ...measurementData } }),
                    },
                ],
                message: 'Found Dimension',
            };
        } else {
            throw new NotFoundException(`No Dimensions found with ID:${dimensionId}`);
        }
    }

    async remove(deleteDimensionDto: DeleteDimensionDto): Promise<DeleteDimensionResponseDto> {
        const { dimensionId, businessID } = deleteDimensionDto;
        const {
            data: [{ measurement }],
        } = await this.findOne({ dimensionId, businessID });
        try {
            const { data: offeringIds } = await this.offeringService.findOfferingIdsByDimensionId({
                dimensionId,
                businessID,
            });
            if (offeringIds.length) {
                throw new ConflictException(
                    `Cannot Delete Dimensions when they are attached to Offerings, remove dimensions from offerings before deleting. Current OfferingIds using the dimension: ${offeringIds.reduce(
                        (acc, item) => {
                            acc += `${item}   `;
                            return acc;
                        },
                        '',
                    )} `,
                );
            }
        } catch (error) {
            if (error instanceof NotFoundException) {
                // Ignore
            } else {
                throw error;
            }
        }

        if (measurement) {
            try {
                if (measurement.measurementMode === measurementMode.infrastructureBased) {
                    const accessInformation = measurement?.measurementConfiguration as InfrastructureAccessInformation;
                    await this.schedulerService.remove({
                        schedulerID: this.createKeyForManagedInfraDimensionSchedule({
                            dimensionId,
                            resourceType: accessInformation.resourceType,
                        }),
                        businessID,
                    });
                }
            } catch (e) {
                AuditService.publishEvent({
                    data: [e],
                    message: 'Error removing measurement dimension from scheduler',
                    topic: AuditScope.ERROR,
                });
            }
        }

        await this.InfluxService.dropDimensionConfig(
            `${process.env.STAGE}-config`,
            process.env.INFLUX_ORG,
            businessID,
            dimensionId,
        );
        return { message: 'deleted dimension document' };
    }
    async update(
        { dimensionId, businessID, ...updatedFields }: UpdateDimensionDto,
        subject: string,
    ): Promise<UpdateDimensionResponse> {
        const {
            data: [{ ...rest }],
        } = await this.findOne({ dimensionId, businessID });
        if (updatedFields?.usageEntitlement === null || updatedFields?.overageAllowed === null) {
            if (
                updatedFields?.usageEntitlement === null &&
                rest?.overageAllowed !== overageAllowedEnum.false &&
                rest?.overageAllowed !== null &&
                rest?.overageAllowed !== undefined &&
                updatedFields?.overageAllowed !== null &&
                updatedFields?.overageAllowed !== overageAllowedEnum.false
            ) {
                throw new BadRequestException(`If entitlement is removed then overage must be removed as well`);
            }
        }

        if (rest?.tiers !== undefined && rest?.tiers !== null) {
            if (
                (updatedFields?.consumptionPrice || updatedFields?.usageEntitlement !== undefined) &&
                updatedFields?.tiers !== null
            ) {
                throw new BadRequestException(`Cannot change a dimension from tiers to non-tiers or vice versa`);
            }
        } else if (updatedFields?.tiers !== undefined && updatedFields?.tiers !== null) {
            throw new BadRequestException(`Cannot change a dimension from tiers to non-tiers or vice versa`);
        }
        const { loadPoints } = this.InfluxService;
        const input = this.transformDtoToEntityInput(
            {
                ...rest,
                ...updatedFields,
                businessID,
                metadata: joinMetadataObjectsAndRemoveNulls(rest?.metadata, updatedFields?.metadata),
            },
            dimensionId,
        );
        const entity = new DimensionEntity(input);
        const dimensionDBModel = DimensionEntity.transformer(entity, this.InfluxService);

        if (updatedFields.measurementId) {
            // Check to see if measurement exists
            const {
                data: [measurement],
            } = await this.measurementConfigService.findOne({
                measurementId: updatedFields.measurementId,
                businessID,
            });
            if (measurement.measurementMode === measurementMode.infrastructureBased) {
                const accessInformation = measurement?.measurementConfiguration as InfrastructureAccessInformation;
                try {
                    DimensionsService.logger.log('Creating new schedules for data gathering for the Dimension');
                    await this.schedulerService.remove({
                        schedulerID: this.createKeyForManagedInfraDimensionSchedule({
                            dimensionId,
                            resourceType: accessInformation.resourceType,
                        }),
                        businessID,
                    });
                } catch (e) {
                    AuditService.publishEvent({
                        data: [e],
                        message: `Error removing dimension from scheduler: dimensionId: ${dimensionId}`,
                        topic: AuditScope.ERROR,
                    });
                }
                try {
                    await this.schedulerService.create({
                        schedulerID: this.createKeyForManagedInfraDimensionSchedule({
                            dimensionId,
                            resourceType: accessInformation.resourceType,
                        }),
                        schedulerType: schedulerType.dimensionDataGathering,
                        schedulerStatus: SchedulerStatus.live,
                        scheduleParameters: {
                            dimensionType: this.ressourceTypeToDimensionType(accessInformation.resourceType),
                            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                            //@ts-ignore
                            dimensionId,
                            businessID,
                            rate: SupportedMeasurementFrequencies.everyFiveMinutes,
                            iamRoleArn: accessInformation?.iamRoleArn,
                            externalId: accessInformation?.externalId,
                            region: accessInformation?.region,
                        },
                        rate: SupportedMeasurementFrequencies.everyFiveMinutes,
                        subject,
                        businessID,
                    });
                } catch (e) {
                    AuditService.publishEvent({
                        data: [e],
                        message: `Error adding schedule for dimension: ${dimensionId}`,
                        topic: AuditScope.ERROR,
                    });
                }
            }
        }

        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, [dimensionDBModel]);
        return { message: 'loaded dimension update', dimensionId: entity.dimensionId };
    }
    async removeAll(deleteDimensionDto): Promise<BasicResponseDTO> {
        const { businessID } = deleteDimensionDto;
        const dimensionIds = await this.InfluxService.getAllDimensionIds({ businessID });
        await Promise.all(
            dimensionIds.map(async ({ dimensionId }) => {
                await this.InfluxService.dropDimensionConfig(
                    `${process.env.STAGE}-config`,
                    process.env.INFLUX_ORG,
                    businessID,
                    dimensionId,
                );
            }),
        );

        return { message: 'deleted dimension document' };
    }

    async findByMeasurementId({ measurementId, businessID }) {
        const results = await this.InfluxService.getAllDimensionIdsWithMeasurementId({ businessID, measurementId });
        const dimensions = await Promise.all(
            results.map(async ({ dimensionId }) => {
                const {
                    data: [{ ...rest }],
                } = await this.findOne({ dimensionId, businessID });
                return rest;
            }),
        );
        const mostRecentElementInLedger = dimensions.filter(({ measurement }) => {
            if (measurement && measurement.measurementId === measurementId) {
                return true;
            } else {
                return false;
            }
        });

        return mostRecentElementInLedger.map(({ dimensionId }) => dimensionId);
    }
    public transformDtoToEntityInput(
        createDimensionDto: ReadDimensionResponseData | CreateDimensionDto,
        dimensionId,
    ): DimensionEntity {
        const {
            consumptionUnit,
            dimensionName,
            usageIncrement,
            rounding,
            usageEntitlement,
            overageAllowed,
            consumptionPrice,
            businessID,
            aggregationInterval: argumentAggregationInternal,
            aggregationMethod: argumentAggregationMethod,
            metadata,
            tiers,
            paymentSchedule,
            sampleType: createDimensionSampleType,
            tiersGroupByMetadata,
        } = createDimensionDto;
        let measurementId;

        //eslint-disable-next-line
        //@ts-ignore
        if (createDimensionDto?.measurementId === null) {
            measurementId = undefined;
        }
        //eslint-disable-next-line
        //@ts-ignore
        else if (createDimensionDto?.measurement?.measurementId) {
            //eslint-disable-next-line
            //@ts-ignore
            measurementId = createDimensionDto?.measurement?.measurementId;
        } else {
            //eslint-disable-next-line
            //@ts-ignore
            measurementId = createDimensionDto?.measurementId;
        }
        let sampleType;
        if (!createDimensionSampleType && paymentSchedule === PaymentSchedule.upfront) {
            sampleType = SampleType.continious;
        } else if (createDimensionSampleType) {
            sampleType = createDimensionSampleType;
        } else {
            sampleType = SampleType.gauge;
        }
        const input = {
            typeofDimension: 'numerical',
            numerical: {
                numericalType: numericalType['int'],
                dimensionUnit: consumptionUnit.unit,
                dimensionUnitType: consumptionUnit.type.toLowerCase(),
                aggregationInterval: argumentAggregationInternal
                    ? argumentAggregationInternal
                    : aggregationInterval['Hour'],
                aggregationMethod: argumentAggregationMethod ? argumentAggregationMethod : aggregationMethod['max'],
                priceSegments: [
                    {
                        lowerLimit: '0',
                        upperLimit: 'inf',
                        price: consumptionPrice,
                    },
                ],
                sampleType,
                usageIncrement,
                rounding,
                usageEntitlement,
                overageAllowed,
                tiers,
                tiersGroupByMetadata,
            },
            businessID,
            dimensionId,
            dimensionName,
            categorical: {},
            measurementId,
            metadata,
            paymentSchedule: paymentSchedule ? paymentSchedule : PaymentSchedule.arrear,
        };
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        return input;
    }
}
