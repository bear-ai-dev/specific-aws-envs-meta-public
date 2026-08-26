import {
    Inject,
    Injectable,
    Logger,
    NotAcceptableException,
    NotFoundException,
    forwardRef,
    ConflictException,
    BadRequestException,
} from '@nestjs/common';
import { CreateOfferingDTO, CreateOfferingResponse } from './dto/createOffering.dto.js';
import { SupportedCurrencies } from './dto/SupportedCurrencies.js';
import { UpdateOfferingResponse } from './dto/createOffering.dto.js';
import { ReadOfferingResponseData, ReadOfferingResponseDTO, ReadPricingDTO } from './dto/readOffering.dto.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { InfluxService } from '../influx/influx.service.js';
import { OfferingPackageEntity } from './entities/offeringPackage.entity.js';
import { OfferingType } from './entities/OfferingType.js';
import { DeleteOfferingDTO, DeleteOfferingResponse } from './dto/deleteOffering.dto.js';
import { DimensionsService } from '../dimensions/dimensions.service.js';
import { UpdateOfferingDto } from './dto/updateOfferingDto.js';
import { randomUUID } from 'crypto';
import { CustomerService } from '../customer/customer.service.js';
import { joinMetadataObjectsAndRemoveNulls } from '../utils/shared/utils.js';
import { EntitlementTypes, UserEntitlements } from '../users/entities/entitlement.entity.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { TokenType } from '../token-consumer/dto/TokenType.js';
import { serializeError } from 'serialize-error';
import { AuditService } from '../audit/audit.service.js';
import { AuditScope } from '../audit/entities/audit.interface.js';
import { ReadDimensionResponseData } from '../dimensions/dto/create-dimension.dto.js';

@Injectable()
export class OfferingService {
    private static readonly logger = new Logger(OfferingService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly InfluxService: InfluxService,
        @Inject(forwardRef(() => DimensionsService)) readonly dimensionService: DimensionsService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => UserEntitlements)) readonly userEntitlements: UserEntitlements,
        @Inject(forwardRef(() => TokenConsumerService)) readonly tokenConsumerService: TokenConsumerService,
    ) {}

    async findAll({ businessID }): Promise<ReadOfferingResponseDTO> {
        OfferingService.logger.log(`Finding all offering documents for Business: ${businessID}`);
        const [results, dimensions] = await Promise.all([
            this.InfluxService.getAllOfferingConfigs({ businessID }),
            this.dimensionService.findAll({ businessID }),
        ]);

        let dimensionMap: { [key: string]: ReadDimensionResponseData } = {};
        if (dimensions?.data && dimensions?.data.length > 0) {
            dimensionMap = dimensions?.data?.reduce((acc, dimension) => {
                acc[dimension?.dimensionId] = dimension;
                return acc;
            }, {});
        }
        const filtered = results.map((offerDbModel): ReadOfferingResponseData => {
            const entity = OfferingPackageEntity.dbModelToEntity(offerDbModel);
            const { dimensionIds, ...rest } = new CreateOfferingDTO(entity);
            const dimensionData = entity.dimensionIds.map((dimensionId) => dimensionMap[dimensionId]);

            if (rest.prepaidCredit) {
                if (/^[ \t]*[0-9]+\.?[0-9]+[ \t]*(\$|usd|USD)?$/.test(rest.prepaidCredit)) {
                    rest.prepaidCredit = rest.prepaidCredit.match(/[0-9]+\.?[0-9]+/)[0];
                } else if (/^[ \t]*(\$|usd|USD)?[ \t]*[0-9]+\.?[0-9]+$/.test(rest.prepaidCredit)) {
                    rest.prepaidCredit = rest.prepaidCredit.match(/[0-9]+\.?[0-9]+/)[0];
                }
                rest.prepaidCredit = parseFloat(rest.prepaidCredit).toString();
            }
            if (rest?.offeringType === OfferingType.usageBased) {
                rest.subscriptionPrice = undefined;
            }
            return { dimensions: dimensionData, offeringId: entity.offeringId, ...rest };
        });

        if (results.length && results.length > 0) {
            return { data: filtered, message: 'Found Offerings' };
        } else {
            return { data: [], message: 'No Offerings found' };
        }
    }

    async findOne({ businessID, offeringId }: ReadPricingDTO): Promise<ReadOfferingResponseDTO> {
        OfferingService.logger.log(`Finding a offering document: ${offeringId} for Business: ${businessID}`);
        const offeringDbModels = await this.InfluxService.getLatestOfferingConfig({ businessID, offeringId });

        if (offeringDbModels.length) {
            const readOfferingResponseData = await Promise.all(
                offeringDbModels.map(async (offerDbModel): Promise<ReadOfferingResponseData> => {
                    const entity = OfferingPackageEntity.dbModelToEntity(offerDbModel);
                    const { dimensionIds, ...rest } = new CreateOfferingDTO(entity);
                    const dimensionData = await Promise.all(
                        entity.dimensionIds.map(async (dimensionId) => {
                            const {
                                data: [dimensionInfo],
                            } = await this.dimensionService.findOne({ businessID, dimensionId });
                            return dimensionInfo;
                        }),
                    );

                    if (rest.prepaidCredit) {
                        if (/^[ \t]*[0-9]+\.?[0-9]+[ \t]*(\$|usd|USD)?$/.test(rest.prepaidCredit)) {
                            rest.prepaidCredit = rest.prepaidCredit.match(/[0-9]+\.?[0-9]+/)[0];
                        } else if (/^[ \t]*(\$|usd|USD)?[ \t]*[0-9]+\.?[0-9]+$/.test(rest.prepaidCredit)) {
                            rest.prepaidCredit = rest.prepaidCredit.match(/[0-9]+\.?[0-9]+/)[0];
                        }
                        rest.prepaidCredit = parseFloat(rest.prepaidCredit).toString();
                    }
                    if (rest?.offeringType === OfferingType.usageBased) {
                        rest.subscriptionPrice = undefined;
                    }
                    return { dimensions: dimensionData, offeringId: entity.offeringId, ...rest };
                }),
            );

            return { data: readOfferingResponseData, message: 'Found Offering' };
        } else {
            throw new NotFoundException(`No offering documents matching ID offeringId:${offeringId}`);
        }
    }
    async create(createOfferingDTO: CreateOfferingDTO, subject: string): Promise<CreateOfferingResponse> {
        const res = await this.userEntitlements.determineIfEntitlementExceeded({
            subject,
            entitlementType: EntitlementTypes.OFFERINGS,
        });
        if (res?.entitlementExceeded) {
            throw new ConflictException(
                `Failed to create offering. Offering entitlement limit of ${res?.entitlementValue} has been reached.`,
            );
        }

        // TODO: Remove all of this validation, and put it into custom DTO validation functions similar to Dimensions
        OfferingService.logger.log('Creating a new Offering', createOfferingDTO);
        if (createOfferingDTO.offeringType === OfferingType.subscription && !createOfferingDTO.subscriptionPrice) {
            throw new BadRequestException('Subscription price is required for subscription offerings');
        }
        if (createOfferingDTO.offeringType === OfferingType.subscription && createOfferingDTO?.minimumCharge) {
            throw new BadRequestException('Minimum charge is not allowed for subscription offerings');
        }

        if (createOfferingDTO.prepaidCredit) {
            if (/^[ \t]*[0-9]+\.?[0-9]+[ \t]*(\$|usd|USD)?$/.test(createOfferingDTO.prepaidCredit)) {
                createOfferingDTO.prepaidCredit = createOfferingDTO.prepaidCredit.match(/[0-9]+\.?[0-9]+/)[0];
            } else if (/^[ \t]*(\$|usd|USD)?[ \t]*[0-9]+\.?[0-9]+$/.test(createOfferingDTO.prepaidCredit)) {
                createOfferingDTO.prepaidCredit = createOfferingDTO.prepaidCredit.match(/[0-9]+\.?[0-9]+/)[0];
            } else {
                throw new NotAcceptableException(
                    `Price is invalid: ${createOfferingDTO.prepaidCredit} should be valid price format: 9.99, $9.99, USD9.99, 9.99$, 9.99USD`,
                );
            }
            createOfferingDTO.prepaidCredit = parseFloat(createOfferingDTO.prepaidCredit).toString();
        }
        const { dimensionIds = [], businessID } = createOfferingDTO;

        // Validate dimensions exist
        await Promise.all(
            dimensionIds.map(async (dimensionId) => this.dimensionService.findOne({ dimensionId, businessID })),
        );
        const { loadPoints } = this.InfluxService;
        const entity = new OfferingPackageEntity({
            businessID,
            currency: SupportedCurrencies.USD,
            ...createOfferingDTO,
            offeringId: randomUUID(),
        });
        const packageDbModel = OfferingPackageEntity.transformer(entity, this.InfluxService);
        OfferingService.logger.log(`Creating a new Offering:`, entity.offeringId);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, packageDbModel);
        try {
            await this.tokenConsumerService.create({
                subject,
                businessID,
                tokenAmount: '1',
                metadata: {
                    tokenType: TokenType.offering,
                },
            });
        } catch (e) {
            OfferingService.logger.error('Failed to meter token for offering', serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to meter token for customer',
                data: [{ businessID, error: serializeError(e) }],
            });
        }
        return { message: 'Offering created', offeringId: entity.offeringId };
    }

    async update({
        offeringId,
        businessID,
        dimensionIds: updatedIdList,
        ...updatedFields
    }: UpdateOfferingDto): Promise<UpdateOfferingResponse> {
        OfferingService.logger.log('Updating an Offering');

        const {
            data: [{ dimensions, ...rest }],
        } = await this.findOne({ offeringId, businessID });
        if (
            (rest?.prepaidCredit && updatedFields?.freeTrialLength) ||
            (rest?.freeTrialLength && updatedFields?.prepaidCredit)
        ) {
            throw new BadRequestException('Free credit and a free trial cannot exist on the same offering');
        }
        if (updatedFields?.billingCycle && rest?.billingCycle !== updatedFields?.billingCycle) {
            throw new BadRequestException('Billing cycle cannot be changed for an offering');
        }
        if (
            (rest?.offeringType === OfferingType.subscription ||
                updatedFields?.offeringType === OfferingType.subscription) &&
            updatedFields?.minimumCharge &&
            updatedFields.offeringType !== OfferingType.usageBased
        ) {
            throw new BadRequestException('Minimum charge is not allowed for subscription offerings');
        }

        OfferingService.logger.log(`Old offering: ${JSON.stringify(rest)}`);
        OfferingService.logger.log(`New offering fields: ${JSON.stringify(updatedFields)}`);
        let dimensionIds = dimensions.map(({ dimensionId }) => dimensionId);
        if (updatedIdList?.length === 0) {
            dimensionIds = undefined;
        } else if (updatedIdList?.length) {
            //Validating Dimensions exist

            await Promise.all(
                updatedIdList.map(async (dimensionId) => this.dimensionService.findOne({ dimensionId, businessID })),
            );

            dimensionIds = [...updatedIdList];
        }
        const { loadPoints } = this.InfluxService;
        const entity = new OfferingPackageEntity({
            dimensionIds,
            ...rest,
            ...updatedFields,
            metadata: joinMetadataObjectsAndRemoveNulls(rest?.metadata, updatedFields?.metadata),
            businessID,
            offeringId,
        });
        const packageDbModel = OfferingPackageEntity.transformer(entity, this.InfluxService);
        OfferingService.logger.log(packageDbModel);
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, packageDbModel);
        return { message: 'Loaded Offering Document and Dimensions', offeringId: entity.offeringId };
    }
    async delete({ businessID, offeringId }: DeleteOfferingDTO): Promise<DeleteOfferingResponse> {
        OfferingService.logger.log(`Attempting to delete offering: ${offeringId} for ${businessID}`);
        const offeringDbModels = await this.InfluxService.getLatestOfferingConfig({ businessID, offeringId });
        try {
            const { data: customerIds } = await this.customerService.findAllCustomersWithOfferingId({
                businessID,
                offeringId,
            });
            if (customerIds.length) {
                throw new ConflictException(
                    `Cannot delete offering when they are attached to customers, remove customers from offerings before deleting. Current customerIds using the offering: ${customerIds.reduce(
                        (acc, { customerId }) => {
                            acc += `${customerId}   `;
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
        if (offeringDbModels.length) {
            const { loadPoints } = this.InfluxService;
            const entity = OfferingPackageEntity.dbModelToEntity(offeringDbModels[0]);
            entity.softDelete = true;
            entity.businessID = businessID;
            const points = OfferingPackageEntity.transformer(entity, this.InfluxService);
            OfferingService.logger.log('Points to delete', points);

            await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);

            return { message: 'Deleted Offering', offeringId: entity.offeringId };
        } else {
            throw new NotFoundException(`No offering documents matching ID offeringId:${offeringId}`);
        }
    }

    async findOfferingIdsByDimensionId({
        businessID,
        dimensionId,
    }: {
        businessID: string;
        dimensionId: string;
    }): Promise<{ data: Array<string>; message: string }> {
        OfferingService.logger.log(`Attempting to find offeringIds by dimensionId: ${dimensionId} for ${businessID}`);
        const dbModels = await this.InfluxService.getAllOfferingIdsByDimensionId({ businessID, dimensionId });
        if (dbModels.length) {
            const offeringIds = dbModels.map(({ offeringId }) => offeringId);
            return { data: offeringIds, message: 'Found offeringIds' };
        } else {
            throw new NotFoundException(`No offering documents matching dimensionId: ${dimensionId}`);
        }
    }
}
