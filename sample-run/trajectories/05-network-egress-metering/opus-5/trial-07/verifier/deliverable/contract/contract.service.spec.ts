import { Test, TestingModule } from '@nestjs/testing';
import { ContractService } from './contract.service';
import { createMock } from '@golevelup/ts-jest';
import { OfferingService } from '../offering/offering.service';
import { CustomerService } from '../customer/customer.service';
import { InvoicesService } from '../invoice/invoices.service';
import { InfluxService } from '../influx/influx.service';
import { ReadOfferingResponseData } from '../offering/dto/readOffering.dto';
import { OfferingType } from '../offering/entities/OfferingType';
import { countBasedUnits, roundingEnum } from '../dimensions/dto/create-dimension.dto';
import { paymentChannel } from '../customer/dto/create-customer.dto';
import { Offering } from '../offering/entities/offeringPackage.entity';
import { ReadCustomerResponseData } from '../customer/entities/customer.entity';
import { DatetimeUtils } from '../utils/datetime';
import { CreateContractResponseDto } from './dto/createContractResponse.dto';

describe('ContractService', () => {
    let service: ContractService;
    let invoicesService: InvoicesService;
    let offeringService: OfferingService;
    let customerService: CustomerService;
    let influxService: InfluxService;

    beforeEach(async () => {
        jest.useFakeTimers('modern').setSystemTime(new Date('2023-08-16'));
        const module: TestingModule = await Test.createTestingModule({
            providers: [ContractService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<ContractService>(ContractService);
        offeringService = module.get(OfferingService);
        customerService = module.get(CustomerService);
        invoicesService = module.get(InvoicesService);
        influxService = module.get(InfluxService);
    });
    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should handle creating a contract and calling influx', async () => {
        const createContractDto = {
            customerId: 'fake-customer-id',
            offeringId: 'fake-offering-id',
            businessID: 'fake-business-id',
            readSettingsResponseData: { id: 'fake-offering-id', name: 'fake-offering-name' },
        };
        const preparedContract = {
            offering: {
                enroll: jest.fn(),
            },
        };
        jest.spyOn(service, 'prepareCustomerContract').mockResolvedValueOnce(preparedContract);
        jest.spyOn(influxService, 'loadPoints');
        jest.spyOn(influxService, 'getPoint');

        await expect(service.create(createContractDto)).resolves.toEqual({
            message: 'Loaded Contract Points',
            ...preparedContract,
        });
        expect(service.prepareCustomerContract).toHaveBeenCalledWith(createContractDto);
        expect(influxService.loadPoints).toHaveBeenCalledTimes(1);
        expect(influxService.loadPoints).toHaveBeenCalledWith(
            `${process.env.STAGE}-config`,
            process.env.INFLUX_ORG,
            expect.anything(),
        );
        expect(influxService.getPoint).toHaveBeenCalledTimes(1);
    });

    it('Should handle preparing a contract correctly in a case with no customer contract overrides', async () => {
        const createContractDto = {
            customerId: 'fake-customer-id',
            offeringId: 'fake-offering-id',
            businessID: 'fake-business-id',
        };
        const offeringConfig: ReadOfferingResponseData = {
            offeringId: 'fake-offering-id',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [],
        };

        jest.spyOn(offeringService, 'findOne').mockResolvedValueOnce({
            data: [offeringConfig],
            message: 'foobar',
        });
        jest.spyOn(service, 'prepareCustomerContract');

        const res = await service.create(createContractDto);
        expect(service.prepareCustomerContract).toHaveBeenCalledWith(createContractDto);
        expect(offeringService.findOne).toHaveBeenCalledWith({
            businessID: createContractDto.businessID,
            offeringId: createContractDto.offeringId,
        });
        expect(res).toEqual({
            message: 'Loaded Contract Points',
            offering: expect.objectContaining({
                enroll: expect.anything(),
            }),
            businessID: createContractDto.businessID,
            customerId: createContractDto.customerId,
            offeringId: createContractDto.offeringId,
            offeringEnrollmentDate: expect.anything(),
            overridesForOffering: expect.objectContaining({}),
            readOfferingResponseData: expect.objectContaining({
                offeringId: 'fake-offering-id',
                offeringName: 'fake-offering-name',
                dimensions: [],
                offeringType: OfferingType.usageBased,
            }),
        });
    });
    it('Should handle preparing a contract correctly in a case with discounts', async () => {
        const createContractDto = {
            customerId: 'fake-customer-id',
            offeringId: 'fake-offering-id',
            businessID: 'fake-business-id',
            discount: {
                name: 'fake-discount-name',
                percentage: '2',
            },
        };
        const offeringConfig: ReadOfferingResponseData = {
            offeringId: 'fake-offering-id',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [],
        };

        jest.spyOn(offeringService, 'findOne').mockResolvedValueOnce({
            data: [offeringConfig],
            message: 'foobar',
        });
        jest.spyOn(service, 'prepareCustomerContract');

        const res = await service.create(createContractDto);
        expect(service.prepareCustomerContract).toHaveBeenCalledWith(createContractDto);
        expect(offeringService.findOne).toHaveBeenCalledWith({
            businessID: createContractDto.businessID,
            offeringId: createContractDto.offeringId,
        });
        expect(res).toEqual({
            message: 'Loaded Contract Points',
            offering: expect.objectContaining({
                enroll: expect.anything(),
                discount: expect.objectContaining({
                    name: createContractDto.discount.name,
                    percentage: createContractDto.discount.percentage,
                }),
            }),
            overridesForOffering: expect.objectContaining({
                discount: expect.objectContaining({
                    name: createContractDto.discount.name,
                    percentage: createContractDto.discount.percentage,
                }),
            }),
            businessID: createContractDto.businessID,
            customerId: createContractDto.customerId,
            offeringId: createContractDto.offeringId,
            offeringEnrollmentDate: expect.anything(),
            readOfferingResponseData: expect.objectContaining({
                offeringId: 'fake-offering-id',
                offeringName: 'fake-offering-name',
                dimensions: [],
                offeringType: OfferingType.usageBased,
            }),
        });
    });
    it('Should handle preparing a contract correctly in a case with discounts and dimensions', async () => {
        const createContractDto = {
            customerId: 'fake-customer-id',
            offeringId: 'fake-offering-id',
            businessID: 'fake-business-id',
            discount: {
                name: 'fake-discount-name',
                percentage: '2',
            },
        };
        const offeringConfig: ReadOfferingResponseData = {
            offeringId: 'fake-offering-id',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };

        jest.spyOn(offeringService, 'findOne').mockResolvedValueOnce({
            data: [offeringConfig],
            message: 'foobar',
        });
        jest.spyOn(service, 'prepareCustomerContract');

        const res = await service.create(createContractDto);
        expect(service.prepareCustomerContract).toHaveBeenCalledWith(createContractDto);
        expect(offeringService.findOne).toHaveBeenCalledWith({
            businessID: createContractDto.businessID,
            offeringId: createContractDto.offeringId,
        });
        expect(res).toEqual({
            message: 'Loaded Contract Points',
            offering: expect.objectContaining({
                enroll: expect.anything(),
                discount: expect.objectContaining({
                    name: createContractDto.discount.name,
                    percentage: createContractDto.discount.percentage,
                }),
            }),
            overridesForOffering: expect.objectContaining({
                discount: expect.objectContaining({
                    name: createContractDto.discount.name,
                    percentage: createContractDto.discount.percentage,
                }),
            }),
            businessID: createContractDto.businessID,
            customerId: createContractDto.customerId,
            offeringId: createContractDto.offeringId,
            offeringEnrollmentDate: expect.anything(),
            readOfferingResponseData: expect.objectContaining({
                offeringId: 'fake-offering-id',
                offeringName: 'fake-offering-name',
                dimensions: expect.arrayContaining([
                    {
                        dimensionId: '123',
                        dimensionName: 'fake-dimension-name',
                        consumptionPrice: '1',
                        consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                        usageIncrement: '1',
                        rounding: roundingEnum.ceiling,
                    },
                ]),
                offeringType: OfferingType.usageBased,
            }),
        });
    });
    it('Should handle enrollments correctly', async () => {
        const offering = {
            enroll: jest.fn(),
        } as unknown as Offering;
        const customer = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'fake-offering-id',
            offering,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
        };
        const subject = 'fake subject';
        const offeringConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.subscription,
            freeTrialLength: '1',
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        const preparedContract = {
            offering,
            customerId: customer.customerId,
            businessID: customer.businessID,
            offeringEnrollmentDate: new Date().toISOString(),
            readOfferingResponseData: offeringConfig,
            offeringId: offering.offeringId,
        };

        const res = await service.enrollCustomerInContract(
            preparedContract,
            subject,
            customer as unknown as ReadCustomerResponseData,
        );

        expect(offering.enroll).toHaveBeenCalledWith(subject, customer);
        expect(res).toEqual({
            message: `Customer: ${preparedContract?.customerId} successfully onboarded`,
        });
    });

    it('ISSUE-1006 Updates for customer should not change the free trial end date if the date is in the past', async () => {
        const oldFreeTrialDate = DatetimeUtils.daysBeforeDate(new Date(), 2).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.subscription,
            freeTrialLength: '1',
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            freeTrialLength: undefined,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: oldFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(res.freeTrialEndDate).toEqual(oldFreeTrialDate);
        expect(res.offeringEnrollmentDate).toBeDefined();
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(1);
        expect(enrollMock).toHaveBeenCalledTimes(1);
    });
    it('Create contract response should set fields appropriately', async () => {
        const contract = new CreateContractResponseDto({
            message: 'foobar',
            offeringEnrollmentDate: new Date().toISOString(),
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'fake-offering-id',
            readOfferingResponseData: {
                offeringId: 'fake-offering-id',
                offeringName: 'fake-offering-name',
                offeringType: OfferingType.subscription,
                dimensions: [],
            },
        });
        expect(contract).toEqual({
            message: 'foobar',
            offeringEnrollmentDate: expect.any(String),
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'fake-offering-id',
            readOfferingResponseData: {
                offeringId: 'fake-offering-id',
                offeringName: 'fake-offering-name',
                offeringType: OfferingType.subscription,
                dimensions: [],
            },
        });
    });
    it('ISSUE-1005 Updates for customer should not change the free trial end date if the date is in the past for usage based offerings', async () => {
        const oldFreeTrialDate = DatetimeUtils.daysBeforeDate(new Date(), 2).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            freeTrialLength: '1',
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            freeTrialLength: undefined,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: oldFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(res.freeTrialEndDate).toEqual(oldFreeTrialDate);
        expect(res.offeringEnrollmentDate).toBeDefined();
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(1);
        expect(enrollMock).toHaveBeenCalledTimes(1);
    });

    it('ISSUE-1004: Should change the free trial end date to this exact moment if the new offering does not have a free trial', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            freeTrialLength: '1',
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(res.freeTrialEndDate).toEqual(newFreeTrialDate);
        expect(res.offeringEnrollmentDate).toBeDefined();
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(1);
        expect(enrollMock).toHaveBeenCalledTimes(1);
    });
    it('ISSUE-1003: Should change the free trial end date to this exact moment if the new offering does not have a free trial', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            freeTrialLength: '1',
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            freeTrialLength: undefined,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(new Date(res.freeTrialEndDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(res.offeringEnrollmentDate).toBeDefined();
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(1);
        expect(enrollMock).toHaveBeenCalledTimes(1);
    });
    it('should call unenrollment with credit when there is another offering included in the update request', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(1);
        expect(enrollMock).toHaveBeenCalledTimes(1);

        expect(unenrollMock).toHaveBeenCalledWith(
            expect.objectContaining({
                shouldCreditRemainingPlan: true,
                isChangeOfPlan: true,
            }),
        );
    });
    it('should call unenrollment once for each old offering if removePriorOffering is set to true', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            } else {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: offeringId,
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering', 'another-offering', 'yet-another-offering'],
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(3);
        expect(enrollMock).toHaveBeenCalledTimes(1);

        expect(unenrollMock).toHaveBeenCalledWith(
            expect.objectContaining({
                shouldCreditRemainingPlan: true,
                isChangeOfPlan: true,
            }),
        );
    });
    it('should call unenrollment once for each old offering if the new offeringId is null', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            } else {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: offeringId,
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering', 'another-offering', 'yet-another-offering'],
            newOfferingId: null,
            subject: 'fake',
            businessID: 'fake-business-id',
        });

        expect(unenrollMock).toHaveBeenCalledTimes(3);
        expect(enrollMock).toHaveBeenCalledTimes(0);

        expect(unenrollMock).toHaveBeenCalledWith(
            expect.objectContaining({
                shouldCreditRemainingPlan: false,
                isChangeOfPlan: false,
            }),
        );
    });
    it('should not call unenrollment once for each old offering if the new offeringId is null and removePriorOffering is false', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            } else {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: offeringId,
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering', 'another-offering', 'yet-another-offering'],
            newOfferingId: null,
            subject: 'fake',
            businessID: 'fake-business-id',
            removePriorOffering: false,
        });

        expect(unenrollMock).toHaveBeenCalledTimes(0);
        expect(enrollMock).toHaveBeenCalledTimes(0);
    });
    it('should not call unenrollment if the request has set removePriorOffering to false', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: 'new-offering',
            businessID: 'fake-business-id',
            subject: 'fake',
            removePriorOffering: false,
        });
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(0);
        expect(enrollMock).toHaveBeenCalledTimes(1);
    });
    it('should set offeringEnrollmentDate if the update includes a new offeringId', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingId: 'current-offering',
            newOfferingId: 'new-offering',
            subject: 'fake',
        });
        expect(res.offeringEnrollmentDate).toBeDefined();
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
    });

    it('should not call unenrollment with credit when there is not another offering in the update request', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: null,
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(unenrollMock).toHaveBeenCalledTimes(1);
        expect(enrollMock).toHaveBeenCalledTimes(0);

        expect(unenrollMock).toHaveBeenCalledWith(
            expect.objectContaining({
                shouldCreditRemainingPlan: false,
                isChangeOfPlan: false,
            }),
        );
    });
    it('should not call unenrollment with credit when there is not an offering in the orginal customer', async () => {
        const newFreeTrialDate = DatetimeUtils.endOfTomorrow(new Date()).toISOString();
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            freeTrialEndDate: newFreeTrialDate,
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(new Date(res.offeringEnrollmentDate).getTime()).toBeCloseTo(new Date().getTime(), -1);
        expect(unenrollMock).toHaveBeenCalledTimes(0);
        expect(enrollMock).toHaveBeenCalledTimes(1);
    });
    it('Should return prepaidCredit if there is prepaid credit on the offering', async () => {
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                            prepaidCredit: '1000',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);
        const enrollMock = jest.fn();
        const unenrollMock = jest.fn();
        jest.spyOn(Offering, 'getInstance').mockImplementation(
            () =>
                ({
                    unenroll: unenrollMock,
                    enroll: enrollMock,
                }) as unknown as Offering,
        );
        const customer: ReadCustomerResponseData = {
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
            offering: currentOfferingConfig,
            paymentChannel: paymentChannel.manual,
            customerName: 'fake-customer-name',
            offeringEnrollmentDate: DatetimeUtils.randomTimeAndDateLastMonth(new Date()).toISOString(),
        };
        const res = await service.changeCustomerContract({
            customer,
            oldOfferingIds: ['current-offering'],
            newOfferingId: 'new-offering',
            subject: 'fake',
            businessID: 'fake-business-id',
        });
        expect(unenrollMock).toHaveBeenCalledTimes(1);
        expect(enrollMock).toHaveBeenCalledTimes(1);

        expect(unenrollMock).toHaveBeenCalledWith(
            expect.objectContaining({
                shouldCreditRemainingPlan: true,
                isChangeOfPlan: true,
            }),
        );
        expect(res.prepaidCredit).toEqual('1000');
    });
    it(`Should take dimensionOverrides from the offering if the contract db model doesnt contain any`, async () => {
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensionOverrides: [
                {
                    dimensionId: '123',
                    consumptionPrice: '2',
                },
            ],
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                            prepaidCredit: '1000',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);

        const res = await service.findOne({
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
        });
        expect(res.offering.dimensions).toEqual([
            {
                dimensionId: '123',
                dimensionName: 'fake-dimension-name',
                consumptionPrice: '2',
                consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                usageIncrement: '1',
                rounding: roundingEnum.ceiling,
            },
        ]);
    });
    it(`Should take dimensionOverrides from the contract db model if it contains any`, async () => {
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensionOverrides: [
                {
                    dimensionId: '123',
                    consumptionPrice: '2',
                },
            ],
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                            prepaidCredit: '1000',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([
            {
                customerId: 'fake-customer-id',
                businessID: 'fake-business-id',
                offeringId: 'current-offering',
                dimensionOverrides: JSON.stringify([
                    {
                        dimensionId: '123',
                        consumptionPrice: '3',
                    },
                ]),
                _value: 'fake-value',
                _measurement: 'fake-me',
                _field: 'fake-field',
                _time: 'fake-time',
            },
        ]);

        const res = await service.findOne({
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
        });
        expect(res.offering.dimensions).toEqual([
            {
                dimensionId: '123',
                dimensionName: 'fake-dimension-name',
                consumptionPrice: '3',
                consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                usageIncrement: '1',
                rounding: roundingEnum.ceiling,
            },
        ]);
    });
    it(`Should handle tier dimension overrides correctly`, async () => {
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensionOverrides: [
                {
                    dimensionId: '123',
                    consumptionPrice: '2',
                    tiers: [
                        {
                            tierPosition: '1',
                            unitPrice: '3',
                            upperBound: '10',
                        },
                    ],
                },
            ],
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                    tiers: [
                        {
                            tierPosition: '1',
                            unitPrice: '100.89',
                            upperBound: '187',
                        },
                    ],
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                            prepaidCredit: '1000',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([
            {
                customerId: 'fake-customer-id',
                businessID: 'fake-business-id',
                offeringId: 'current-offering',
                dimensionOverrides: JSON.stringify([
                    {
                        dimensionId: '123',
                        tiers: [
                            {
                                tierPosition: '1',
                                unitPrice: '4',
                                upperBound: '10',
                            },
                        ],
                    },
                ]),
                _value: 'fake-value',
                _measurement: 'fake-me',
                _field: 'fake-field',
                _time: 'fake-time',
            },
        ]);

        const res = await service.findOne({
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
        });
        expect(res.offering.dimensions).toEqual([
            {
                dimensionId: '123',
                dimensionName: 'fake-dimension-name',
                consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                usageIncrement: '1',
                rounding: roundingEnum.ceiling,
                tiers: [
                    {
                        tierPosition: '1',
                        unitPrice: '4',
                        upperBound: '10',
                    },
                ],
            },
        ]);
    });
    it(`Should take tier overrides from the offering if there are none on the contract`, async () => {
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensionOverrides: [
                {
                    dimensionId: '123',
                    tiers: [
                        {
                            tierPosition: '1',
                            unitPrice: '3',
                            upperBound: '10',
                        },
                    ],
                },
            ],
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                    tiers: [
                        {
                            tierPosition: '1',
                            unitPrice: '100.89',
                            upperBound: '187',
                        },
                    ],
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                            prepaidCredit: '1000',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([]);

        const res = await service.findOne({
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
        });
        expect(res.offering.dimensions).toEqual([
            {
                dimensionId: '123',
                dimensionName: 'fake-dimension-name',
                consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                usageIncrement: '1',
                rounding: roundingEnum.ceiling,
                tiers: [
                    {
                        tierPosition: '1',
                        unitPrice: '3',
                        upperBound: '10',
                    },
                ],
            },
        ]);
    });
    it(`Should still take offering dimension overrides if the contract exists but contains undefined for dimensionOverrides`, async () => {
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensionOverrides: [
                {
                    dimensionId: '123',
                    consumptionPrice: '2',
                },
            ],
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionPrice: '1',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                            prepaidCredit: '1000',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([
            {
                customerId: 'fake-customer-id',
                businessID: 'fake-business-id',
                offeringId: 'current-offering',
                dimensionOverrides: undefined,
                _value: 'fake-value',
                _measurement: 'fake-me',
                _field: 'fake-field',
                _time: 'fake-time',
            },
        ]);

        const res = await service.findOne({
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
        });
        expect(res.offering.dimensions).toEqual([
            {
                dimensionId: '123',
                dimensionName: 'fake-dimension-name',
                consumptionPrice: '2',
                consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                usageIncrement: '1',
                rounding: roundingEnum.ceiling,
            },
        ]);
    });
    it(`Should still take offering dimension overrides for tiers if the contract exists but contains undefined for dimensionOverrides`, async () => {
        const currentOfferingConfig: ReadOfferingResponseData = {
            offeringId: 'current-offering',
            offeringName: 'fake-offering-name',
            offeringType: OfferingType.usageBased,
            dimensionOverrides: [
                {
                    dimensionId: '123',
                    tiers: [
                        {
                            tierPosition: '1',
                            unitPrice: '3',
                            upperBound: '10',
                        },
                    ],
                },
            ],
            dimensions: [
                {
                    dimensionId: '123',
                    dimensionName: 'fake-dimension-name',
                    consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                    usageIncrement: '1',
                    rounding: roundingEnum.ceiling,
                    tiers: [
                        {
                            tierPosition: '1',
                            unitPrice: '100.89',
                            upperBound: '187',
                        },
                    ],
                },
            ],
        };
        jest.spyOn(offeringService, 'findOne').mockImplementation(async ({ offeringId }) => {
            if (offeringId === 'current-offering') {
                return { data: [currentOfferingConfig], message: 'foobar' };
            } else if (offeringId === 'new-offering') {
                return {
                    data: [
                        {
                            ...currentOfferingConfig,
                            offeringId: 'new-offering',
                            offeringName: 'new-offering-name',
                            prepaidCredit: '1000',
                        },
                    ],
                    message: 'foobar',
                };
            }
        });
        jest.spyOn(influxService, 'getLatestCustomerContract').mockResolvedValue([
            {
                customerId: 'fake-customer-id',
                businessID: 'fake-business-id',
                offeringId: 'current-offering',
                dimensionOverrides: undefined,
                _value: 'fake-value',
                _measurement: 'fake-me',
                _field: 'fake-field',
                _time: 'fake-time',
            },
        ]);

        const res = await service.findOne({
            customerId: 'fake-customer-id',
            businessID: 'fake-business-id',
            offeringId: 'current-offering',
        });
        expect(res.offering.dimensions).toEqual([
            {
                dimensionId: '123',
                dimensionName: 'fake-dimension-name',
                consumptionUnit: { type: 'count', unit: countBasedUnits['count-based'] },
                usageIncrement: '1',
                rounding: roundingEnum.ceiling,
                tiers: [
                    {
                        tierPosition: '1',
                        unitPrice: '3',
                        upperBound: '10',
                    },
                ],
            },
        ]);
    });
});
