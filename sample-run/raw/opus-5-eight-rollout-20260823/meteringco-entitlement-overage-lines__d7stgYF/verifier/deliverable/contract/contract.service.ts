import { BadRequestException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { CreateContractDto } from './dto/createContract.dto';
import { Offering } from '../offering/entities/offeringPackage.entity';
import { ContractEntity } from './entities/contract.entity';
import { InfluxService } from '../influx/influx.service';
import { BasicResponseDTO } from '../basicResponseDTO';
import { ReadContractDto, ReadContractResponseDto } from './dto/readContract.dto';
import { OfferingService } from '../offering/offering.service';
import { ReadOfferingResponseData } from '../offering/dto/readOffering.dto';
import { InvoicesService } from '../invoice/invoices.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { CustomerService } from '../customer/customer.service';
import { CustomOverrides, PrepareContractResponseDto } from './dto/prepareContractResponse.dto';
import { CustomerContractDiscount } from './dto/customerContractDiscount';
import { CreateContractResponseDto } from './dto/createContractResponse.dto';
import { CustomerEntity, ReadCustomerResponseData } from '../customer/entities/customer.entity';
import { SettingsService } from '../setting/settings.service';
import { CreditService } from '../credit/credit.service';
import { ContractInfluxRow } from '../influx/entities/contractInfluxRow';
import { joinMetadataObjectsAndRemoveNulls } from '../utils/shared/utils';
import { UsageForCustomerEnrollment } from '../usage/dto/create-usage.dto';
import { AuditService } from '../audit/audit.service';
import { AuditScope } from '../audit/entities/audit.interface';
import { UsageService } from '../usage/usage.service';
import { serializeError } from 'serialize-error';
import { InfluxAggregateUsageEvent } from '../influx/influxUsageAggregateEvent';
import { CreateDimensionDto } from '../dimensions/dto/create-dimension.dto';
import { ReadDimensionResponseData } from 'dimensions/dto/create-dimension.dto';
import { ValidationError } from 'class-validator';
import { ReadSettingsResponseData } from '../setting/dto/read-setting.dto';

@Injectable()
export class ContractService {
    static logger = new Logger(ContractService.name);
    constructor(
        @Inject(forwardRef(() => InfluxService)) readonly influxService: InfluxService,
        @Inject(forwardRef(() => OfferingService)) readonly offeringService: OfferingService,
        @Inject(forwardRef(() => InvoicesService)) readonly invoicesService: InvoicesService,
        @Inject(forwardRef(() => SchedulerService)) readonly schedulerService: SchedulerService,
        @Inject(forwardRef(() => CustomerService)) readonly customerService: CustomerService,
        @Inject(forwardRef(() => SettingsService)) readonly settingsService: SettingsService,
        @Inject(forwardRef(() => CreditService)) readonly creditService: CreditService,
        @Inject(forwardRef(() => UsageService)) readonly usageService: UsageService,
    ) {}
    async create(createContractDto: CreateContractDto): Promise<CreateContractResponseDto> {
        const preparedContract = await this.prepareCustomerContract(createContractDto);

        const entity = new ContractEntity(preparedContract?.offering, {
            businessID: createContractDto.businessID,
            customerId: createContractDto.customerId,
            offeringId: createContractDto.offeringId,
            offeringEnrollmentDate: preparedContract.offeringEnrollmentDate,

            ...preparedContract?.overridesForOffering,
        });
        const points = ContractEntity.transformer(entity, this.influxService);
        const { loadPoints } = this.influxService;
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        return { message: 'Loaded Contract Points', ...preparedContract };
    }
    async findOne(
        readContractDto: ReadContractDto,
        argOffering?: ReadOfferingResponseData,
        argSettings?: ReadSettingsResponseData,
        argContract?: ContractInfluxRow[],
    ): Promise<ReadContractResponseDto> {
        // Takes in an offering, customerId, and businessID
        // Returns the latest contract for that customer which is basically the offering with overrides.
        const { customerId, businessID, offeringId } = readContractDto;
        let offeringResponseData: ReadOfferingResponseData = argOffering;
        if (!offeringResponseData) {
            const { data } = await this.offeringService.findOne({
                businessID,
                offeringId,
            });
            offeringResponseData = data[0];
        }
        let readSettingsResponseData: ReadSettingsResponseData = argSettings;
        if (!readSettingsResponseData) {
            const [settingsData] = await this.settingsService.findAll({ businessID });
            readSettingsResponseData = settingsData;
        }
        const offering = Offering.getInstance(
            offeringResponseData,
            customerId,
            businessID,
            this.invoicesService,
            readSettingsResponseData,
            this.schedulerService,
            this.customerService,
        );

        let contractDbModel: ContractInfluxRow[] = argContract;
        if (!contractDbModel) {
            const { getLatestCustomerContract } = this.influxService;
            contractDbModel = await getLatestCustomerContract({
                customerId: readContractDto.customerId,
                businessID: readContractDto.businessID,
            });
        }
        if (contractDbModel && Array.isArray(contractDbModel) && contractDbModel.length > 0) {
            const entity = ContractEntity.dbModelToEntity(contractDbModel[0], offering);
            return new ReadContractResponseDto(
                {
                    ...entity,
                    dimensionOverrides: entity?.dimensionOverrides
                        ? entity?.dimensionOverrides
                        : offering?.dimensionOverrides,
                },
                offeringResponseData,
            );
        } else {
            return new ReadContractResponseDto(
                {
                    offering,
                    offeringEnrollmentDate: readContractDto?.offeringEnrollmentDate,
                    customerId: readContractDto?.customerId,
                    businessID: readContractDto?.businessID,
                    freeTrialEndDate: readContractDto?.freeTrialEndDate,
                    dimensionOverrides: offering?.dimensionOverrides,
                    offeringId,
                },
                offeringResponseData,
            );
        }
    }

    async findAll({
        businessID,
        customers,
    }: {
        businessID: string;
        customers: Array<CustomerEntity>;
    }): Promise<ReadContractResponseDto[]> {
        const { getCustomerContracts } = this.influxService;
        const contractsDbModel = await getCustomerContracts({ businessID });

        const contractMap = contractsDbModel.reduce((acc, contractDbModel) => {
            const { customerId, offeringId } = contractDbModel;
            acc[`${customerId}${offeringId}`] = contractDbModel;
            return acc;
        }, {});

        const [readSettingsResponseData] = await this.settingsService.findAll({ businessID });
        const { data: readAllOfferingResponseData } = await this.offeringService.findAll({ businessID });
        const offeringIdMap = readAllOfferingResponseData.reduce(
            (acc, { offeringId, ...rest }) => {
                acc[`${offeringId}`] = { offeringId, ...rest };
                return acc;
            },
            {} as { [key: string]: ReadOfferingResponseData },
        );
        const contracts = customers.reduce((acc, customer) => {
            const { customerId, offeringIds } = customer;
            offeringIds.forEach((offeringId) => {
                const contractDbModel = contractMap[`${customerId}${offeringId}`];
                if (contractDbModel === undefined) {
                    const offering = Offering.getInstance(
                        offeringIdMap[`${offeringId}`],
                        customerId,
                        businessID,
                        this.invoicesService,
                        readSettingsResponseData,
                        this.schedulerService,
                        this.customerService,
                    );
                    acc.push(
                        new ReadContractResponseDto(
                            {
                                offering,
                                offeringEnrollmentDate: customer?.offeringEnrollmentDate,
                                customerId,
                                businessID,
                                freeTrialEndDate: customer?.freeTrialEndDate,
                                offeringId,
                            },
                            offeringIdMap[`${offeringId}`],
                        ),
                    );
                } else if ('_value' in contractDbModel) {
                    console.log('contractDbModel found in DB', contractDbModel);

                    const offering = Offering.getInstance(
                        offeringIdMap[`${offeringId}`],
                        customerId,
                        businessID,
                        this.invoicesService,
                        readSettingsResponseData,
                        this.schedulerService,
                        this.customerService,
                    );
                    const entity = ContractEntity.dbModelToEntity(contractDbModel, offering);
                    acc.push(new ReadContractResponseDto(entity, offeringIdMap[`${offeringId}`]));
                }
            });

            return acc;
        }, [] as ReadContractResponseDto[]);
        return contracts;
    }
    async findAllContractsForCustomer(readContractDtos: ReadContractDto[]): Promise<ReadContractResponseDto[]> {
        if (!readContractDtos || !readContractDtos.length) {
            return [];
        }
        const businessID = readContractDtos[0].businessID;
        const offerings = await this.offeringService.findAll({ businessID });
        const offeringMap = offerings.data.reduce((acc, offering) => {
            acc[offering.offeringId] = offering;
            return acc;
        }, {});
        const { getCustomerContracts } = this.influxService;
        const contractsDbModel = await getCustomerContracts({ businessID });
        const contractMap: Record<string, ContractInfluxRow> = contractsDbModel.reduce((acc, singleContractRow) => {
            const { customerId, offeringId } = singleContractRow;
            acc[`${customerId}${offeringId}`] = singleContractRow;
            return acc;
        }, {});
        const [readSettingsResponseData] = await this.settingsService.findAll({ businessID });
        return Promise.all(
            readContractDtos.map((readContractDto) => {
                const { customerId } = readContractDto;
                const contract = contractMap[`${customerId}${readContractDto.offeringId}`];
                const offering = offeringMap[readContractDto.offeringId];
                if (contract) {
                    return this.findOne(
                        { customerId, offeringId: readContractDto.offeringId, businessID },
                        offering,
                        readSettingsResponseData,
                        [contract],
                    );
                } else {
                    return this.findOne(
                        { customerId, offeringId: readContractDto.offeringId, businessID },
                        offering,
                        readSettingsResponseData,
                        [],
                    );
                }
            }),
        );
    }
    async update({
        customerId,
        businessID,
        offeringId,
        overridesForOffering,
    }: {
        customerId: string;
        businessID: string;
        offeringId: string;
        overridesForOffering: CustomOverrides;
    }): Promise<{ message: string }> {
        const {
            offering,
            overridesForOffering: currentOverridesForOffering,
            offeringEnrollmentDate,
        } = await this.findOne({
            businessID,
            customerId,
            offeringId,
        });
        const entity = new ContractEntity(offering, {
            businessID,
            customerId,
            offeringId,
            discount: joinMetadataObjectsAndRemoveNulls(
                currentOverridesForOffering?.discount as unknown as Record<string, string>,
                overridesForOffering?.discount as unknown as Record<string, string>,
            ) as unknown as CustomerContractDiscount,
            offeringEnrollmentDate,
            freeTrialEndDate: overridesForOffering?.freeTrialEndDate
                ? overridesForOffering?.freeTrialEndDate
                : currentOverridesForOffering?.freeTrialEndDate,
        });
        const points = ContractEntity.transformer(entity, this.influxService);
        const { loadPoints } = this.influxService;
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
        return { message: 'Updated Contract' };
    }

    async enrollCustomerInContract(
        preparedContract: PrepareContractResponseDto,
        subject: string,
        customer: ReadCustomerResponseData,
    ): Promise<BasicResponseDTO> {
        const { offering, offeringId, prepaidCredit, businessID, customerId } = preparedContract;

        if (prepaidCredit) {
            await this.creditService.create(
                {
                    transactionAmount: prepaidCredit,
                    customerId,
                    businessID,
                    metadata: {
                        offeringId: offeringId ? offeringId : undefined,
                        reason: `${offering.offeringName} free trial credit`,
                    },
                    timestamp: new Date().toISOString(),
                },
                false,
            );
        }
        await offering.enroll(subject, customer);

        return { message: `Customer: ${preparedContract?.customerId} successfully onboarded` };
    }
    async prepareCustomerContract(createContractDto: CreateContractDto): Promise<PrepareContractResponseDto> {
        const { customerId, offeringId, businessID, readSettingsResponseData, usageOverrides, ...rest } =
            createContractDto;
        const offeringEnrollmentDate = rest.offeringEnrollmentDate
            ? rest.offeringEnrollmentDate
            : new Date().toISOString();
        let offeringConfig: ReadOfferingResponseData;
        let setReadSettingsResponseData = readSettingsResponseData;
        if (!setReadSettingsResponseData) {
            const [readSettingsResponseDataRes] = await this.settingsService.findAll({ businessID });
            setReadSettingsResponseData = readSettingsResponseDataRes;
        }
        try {
            const {
                data: [offeringData],
            } = await this.offeringService.findOne({ businessID, offeringId });
            offeringConfig = offeringData;
        } catch (e) {
            if (e instanceof NotFoundException) {
                throw new BadRequestException(`Failed to create customer. Offering with ID: ${offeringId} not found`);
            } else {
                throw new BadRequestException(e);
            }
        }

        let freeTrialEndDate;
        if (createContractDto?.freeTrialEndDate) {
            freeTrialEndDate = createContractDto.freeTrialEndDate;
        } else if (offeringConfig?.freeTrialLength) {
            freeTrialEndDate = Offering.calculateFreeTrialEndDate(offeringConfig.freeTrialLength);
        }
        let createUsageDtoFromUsage;
        if (usageOverrides && usageOverrides?.length) {
            try {
                createUsageDtoFromUsage = usageOverrides.map((usage) => ({ ...usage, customerId, businessID }));
                await Promise.all(
                    usageOverrides.map(async (usage) =>
                        this.usageService.create({
                            ...usage,
                            customerId,
                            businessID,
                            timestamp: offeringEnrollmentDate,
                        }),
                    ),
                );
            } catch (e) {
                ContractService.logger.error('Failed to load usage data for customer');
                ContractService.logger.error(serializeError(e));
                AuditService.publishEvent({
                    message: 'Error creating usage records for customer in enrollment',
                    topic: AuditScope.ERROR,
                    data: [{ error: e, usage: usageOverrides }],
                });
            }
        }
        let offering = Offering.getInstance(
            offeringConfig,
            customerId,
            businessID,
            this.invoicesService,
            setReadSettingsResponseData,
            this.schedulerService,
            this.customerService,
            freeTrialEndDate,
            usageOverrides
                ? InfluxAggregateUsageEvent.convertCreateUsageDtoToAggregateUsageResponse(createUsageDtoFromUsage)
                : undefined,
        );
        try {
            offering = await ContractService.overrideDefaultOfferingValues({
                offering,
                createContractDto: createContractDto,
            });
        } catch (e) {
            if (Array.isArray(e) && e.length > 0) {
                if (e[0] instanceof ValidationError) {
                    throw new BadRequestException(e);
                } else {
                    throw e;
                }
            } else {
                throw e;
            }
        }
        const creditAmount = offeringConfig?.prepaidCredit;

        return new PrepareContractResponseDto({
            overridesForOffering: new CustomOverrides({
                discount: rest?.discount?.name && new CustomerContractDiscount(rest?.discount),
                freeTrialEndDate,
                dimensionOverrides: rest?.dimensionOverrides,
            }),
            customerId,
            offeringId,
            businessID,
            offering,
            offeringEnrollmentDate,
            prepaidCredit: creditAmount,
            readOfferingResponseData: offeringConfig,
        });
    }
    public static async overrideDefaultOfferingValues({
        offering,
        createContractDto,
    }: {
        offering: Offering;
        createContractDto: CreateContractDto;
    }): Promise<Offering> {
        if (createContractDto?.discount) {
            offering.discount = createContractDto.discount;
        }
        if (createContractDto?.dimensionOverrides && createContractDto?.dimensionOverrides?.length > 0) {
            await Promise.all(
                createContractDto.dimensionOverrides.map(async (dimensionOverride) => {
                    const { dimensionId, ...rest } = dimensionOverride;
                    offering.dimensions = await Promise.all(
                        offering.dimensions.map(async (dimension) => {
                            if (dimension.dimensionId === dimensionId) {
                                const input = { ...dimension, ...rest } as ReadDimensionResponseData;
                                const dimensionWithOverrides = new CreateDimensionDto(input);
                                await CreateDimensionDto.validator(dimensionWithOverrides);
                                return input;
                            }
                            return dimension;
                        }),
                    );
                }),
            );
        } else if (offering?.dimensionOverrides && offering?.dimensionOverrides?.length > 0) {
            await Promise.all(
                offering?.dimensionOverrides.map(async (dimensionOverride) => {
                    const { dimensionId, ...rest } = dimensionOverride;
                    offering.dimensions = await Promise.all(
                        offering.dimensions.map(async (dimension) => {
                            if (dimension.dimensionId === dimensionId) {
                                const input = {
                                    ...dimension,
                                    ...rest,
                                } as ReadDimensionResponseData;
                                const dimensionWithOverrides = new CreateDimensionDto(input);
                                await CreateDimensionDto.validator(dimensionWithOverrides);
                                return input;
                            }
                            return dimension;
                        }),
                    );
                }),
            );
        }
        return offering;
    }

    async changeCustomerContract({
        customer,
        newOfferingId,
        oldOfferingIds,
        businessID,
        subject,
        overridesForCustomer,
        usageOverrides,
        removePriorOffering = true,
        unenrollOfferingId,
    }: {
        customer: ReadCustomerResponseData;
        subject: string;
        businessID: string;
        oldOfferingIds?: string[] | null;
        newOfferingId?: string | null;
        overridesForCustomer?: CustomOverrides;
        usageOverrides?: UsageForCustomerEnrollment[];
        removePriorOffering?: boolean;
        unenrollOfferingId?: string;
    }): Promise<{
        message: string;
        freeTrialEndDate?: string;
        offeringEnrollmentDate?: string;
        freeTrialStartDate?: string;
        prepaidCredit?: string;
    }> {
        let freeTrialEndDate;
        let freeTrialStartDate;
        let prepaidCredit;
        if ((newOfferingId || newOfferingId === null) && !oldOfferingIds?.includes(newOfferingId)) {
            let priorOfferingEnrollmentDate;
            let offeringEnrollmentDate;
            if (oldOfferingIds && oldOfferingIds.length && removePriorOffering) {
                freeTrialStartDate = customer?.freeTrialStartDate;
                await Promise.all(
                    oldOfferingIds.map(async (oldOfferingId) => {
                        const contract = await this.findOne({
                            customerId: customer.customerId,
                            offeringId: oldOfferingId,
                            businessID,
                            offeringEnrollmentDate: customer.offeringEnrollmentDate,
                            freeTrialEndDate: customer.freeTrialEndDate,
                        });
                        priorOfferingEnrollmentDate = contract.offeringEnrollmentDate;
                        if (
                            contract?.overridesForOffering?.freeTrialEndDate &&
                            new Date(contract?.overridesForOffering?.freeTrialEndDate).getTime() > new Date().getTime()
                        ) {
                            freeTrialEndDate = new Date(new Date().getTime()).toISOString();
                        } else if (contract?.overridesForOffering?.freeTrialEndDate) {
                            freeTrialEndDate = contract?.overridesForOffering?.freeTrialEndDate;
                        }

                        await contract.offering.unenroll({
                            shouldCreditRemainingPlan: Boolean(newOfferingId),
                            isChangeOfPlan: Boolean(newOfferingId),
                            customer,
                            creditService: this.creditService,
                        });
                        await this.delete({
                            offeringId: oldOfferingId,
                            customerId: customer.customerId,
                            businessID,
                        });
                    }),
                );
            }
            if (newOfferingId) {
                const contract = await this.create({
                    offeringId: newOfferingId,
                    customerId: customer.customerId,
                    businessID,
                    usageOverrides,
                    offeringEnrollmentDate: new Date().toISOString(),
                    ...overridesForCustomer,
                });
                offeringEnrollmentDate = contract.offeringEnrollmentDate;
                contract.offering.priorOfferingEnrollmentDate = priorOfferingEnrollmentDate
                    ? priorOfferingEnrollmentDate
                    : undefined;
                freeTrialEndDate = contract?.overridesForOffering?.freeTrialEndDate
                    ? contract?.overridesForOffering?.freeTrialEndDate
                    : freeTrialEndDate;
                const updatedOfferingCustomer = new ReadCustomerResponseData(
                    {
                        ...customer,
                        offeringEnrollmentDate,
                        freeTrialEndDate,
                        freeTrialStartDate:
                            !customer?.freeTrialStartDate && freeTrialEndDate
                                ? new Date().toISOString()
                                : customer?.freeTrialStartDate,
                    },
                    [],
                    contract,
                );
                await this.enrollCustomerInContract(contract, subject, updatedOfferingCustomer);
                freeTrialStartDate = updatedOfferingCustomer?.freeTrialStartDate;
                prepaidCredit = contract?.prepaidCredit;
            }
            return {
                message: 'Successfully changed customer contract',
                freeTrialEndDate,
                freeTrialStartDate,
                offeringEnrollmentDate,
                prepaidCredit,
            };
        }
        if (unenrollOfferingId) {
            const contract = await this.findOne({
                customerId: customer.customerId,
                offeringId: unenrollOfferingId,
                businessID,
            });
            await contract.offering.unenroll({
                shouldCreditRemainingPlan: false,
                isChangeOfPlan: false,
                customer,
                creditService: this.creditService,
            });
            await this.delete({
                offeringId: unenrollOfferingId,
                customerId: customer.customerId,
                businessID,
            });
            return {
                message: 'Successfully unenrolled customer from offering',
            };
        }
    }
    async delete({ customerId, offeringId, businessID }) {
        const {
            offering,
            overridesForOffering: currentOverridesForOffering,
            offeringEnrollmentDate,
        } = await this.findOne({
            businessID,
            customerId,
            offeringId,
        });
        const softDelete = true;
        const entity = new ContractEntity(
            offering,
            {
                businessID,
                customerId,
                offeringId,
                discount: currentOverridesForOffering?.discount,
                offeringEnrollmentDate,
                freeTrialEndDate: currentOverridesForOffering?.freeTrialEndDate,
            },
            softDelete,
        );
        const points = ContractEntity.transformer(entity, this.influxService);
        const { loadPoints } = this.influxService;
        await loadPoints(`${process.env.STAGE}-config`, process.env.INFLUX_ORG, points);
    }
}
