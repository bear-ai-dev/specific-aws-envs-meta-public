import { Test, TestingModule } from '@nestjs/testing';
import { OfferingService } from './offering.service.js';
import { InfluxService } from '../influx/influx.service.js';
import { CreateOfferingDTO, OfferingVisibility, ValidBillingCycles } from './dto/createOffering.dto.js';
import { DimensionsService } from '../dimensions/dimensions.service.js';
import { OfferingPackageEntity } from './entities/offeringPackage.entity.js';
import { OfferingType } from './entities/OfferingType.js';
import { ReadDimensionResponseData } from 'dimensions/dto/create-dimension.dto.js';
import { dataBasedUnits, roundingEnum } from '../dimensions/dto/create-dimension.dto.js';
import { CustomerService } from '../customer/customer.service.js';
import { UserEntitlements } from '../users/entities/entitlement.entity.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';

describe('OfferingService', () => {
    const mockData: CreateOfferingDTO = {
        offeringVisibility: OfferingVisibility.private,
        billingCycle: ValidBillingCycles.monthly,

        offeringName: 'testpricingplan',

        currency: 'USD',

        businessID: 'test1234',

        offeringType: OfferingType.usageBased,
        dimensionIds: ['12345'],
    };
    const mockFoundInfluxData: Array<any> = [
        {
            offeringId: 'fake',
            offeringType: 'usage-based',
            offeringVisibility: 'private',
            _value: 'temp',
            _field: 'offeringName',
            currency: 'USD',
            businessID: 'myCoolCorp',
            _measurement: OfferingPackageEntity._measurement,
            _time: new Date().toISOString(),
            dimensionId_12345: '12345',
        },
    ];

    const transformerMock = jest.spyOn(OfferingPackageEntity, 'transformer').mockImplementation(() => {
        return [];
    });
    let service: OfferingService;
    const mockLoadPoints = jest.fn();
    const mockFindOne = jest.fn((): { data: ReadDimensionResponseData[]; message: string } => ({
        data: [
            {
                dimensionId: '12345',
                dimensionName: 'myCoolName',
                consumptionPrice: '20.00',
                consumptionUnit: { unit: dataBasedUnits.gigabyte, type: 'data' },
                usageIncrement: 1,
                rounding: roundingEnum.ceiling,
            },
        ],
        message: 'test message',
    }));
    const mockTag = jest.fn();
    const mockGetLatestOfferingConfig = jest.fn(() => mockFoundInfluxData);
    let determineIfEntitlementExceededMock = jest.fn();
    let userEntitlements: UserEntitlements;
    beforeEach(async () => {
        determineIfEntitlementExceededMock = jest.fn();
        process.env.STAGE = 'unit-test';
        const module: TestingModule = await Test.createTestingModule({
            providers: [OfferingService],
            imports: [],
        })
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: mockTag, stringField: jest.fn() }),
                        getLatestOfferingConfig: mockGetLatestOfferingConfig,
                        getMeteringCoCustomers: jest.fn(),
                    };
                }
                if (token === DimensionsService) {
                    return {
                        findOne: mockFindOne,
                    };
                }
                if (token === CustomerService) {
                    return {};
                }
                if (token === UserEntitlements) {
                    return {
                        determineIfEntitlementExceeded: determineIfEntitlementExceededMock,
                    };
                }
                if (token === TokenConsumerService) {
                    return {
                        create: jest.fn(),
                    };
                }
            })
            .compile();

        service = module.get<OfferingService>(OfferingService);
        userEntitlements = module.get<UserEntitlements>(UserEntitlements);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });
    afterAll(() => {
        process.env.STAGE = undefined;
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('should call load points correctly', async () => {
        await service.create(mockData);
        expect(mockLoadPoints).toBeCalledTimes(1);
    });
    it('should check if dimensions are live', async () => {
        await service.create(mockData);
        expect(mockFindOne).toBeCalledTimes(mockData.dimensionIds.length);
    });
    it('should handle idempotent put updates correctly', async () => {
        await service.update({ ...mockData, offeringId: 'fake' });
        expect(mockLoadPoints).toBeCalledTimes(1);
        expect(transformerMock).toBeCalledTimes(1);
        expect(mockGetLatestOfferingConfig).toBeCalledTimes(1);
        expect(mockGetLatestOfferingConfig).toBeCalledWith({ businessID: mockData.businessID, offeringId: 'fake' });
        expect(transformerMock).toBeCalledWith(expect.objectContaining({ dimensionIds: ['12345'] }), expect.anything());
    });

    it('should throw a bad request error if entitlements are exceeded', async () => {
        jest.spyOn(userEntitlements, 'determineIfEntitlementExceeded').mockResolvedValueOnce({
            entitlementExceeded: true,
            entitlementValue: '100',
            currentValue: '101',
        });
        await expect(service.create(mockData)).rejects.toThrowError();
        expect(mockLoadPoints).toBeCalledTimes(0);
    });
    it('should allow creation of offerings if entitlements are not exceeded', async () => {
        jest.spyOn(userEntitlements, 'determineIfEntitlementExceeded').mockResolvedValueOnce({
            entitlementExceeded: false,
            entitlementValue: '100',
            currentValue: '99',
        });
        await expect(service.create(mockData)).resolves.toBeDefined();
        expect(mockLoadPoints).toBeCalledTimes(1);
        expect(transformerMock).toBeCalledTimes(1);
    });
    it('Should still enable getting offerings even if the entitlements are exceeded', async () => {
        jest.spyOn(userEntitlements, 'determineIfEntitlementExceeded').mockResolvedValueOnce({
            entitlementExceeded: true,
            entitlementValue: '100',
            currentValue: '101',
        });
        await expect(service.findOne({ offeringId: 'fake', businessID: 'fake' })).resolves.toBeDefined();
    });
});
