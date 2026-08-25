import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service.js';
import { LocalJWTAuthService } from '../authz/jwt-local.strategy.js';
import { paymentChannel } from './dto/create-customer.dto.js';
import { SupportedCurrencies } from '../offering/dto/SupportedCurrencies.js';
import { InfluxService } from '../influx/influx.service.js';
import { DatetimeUtils } from '../utils/datetime.js';
import { CreditService } from '../credit/credit.service.js';
import { SettingsService } from '../setting/settings.service.js';
import { ReadOfferingResponseDTO, ReadPricingDTO } from '../offering/dto/readOffering.dto.js';
import { OfferingService } from '../offering/offering.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { UsageService } from '../usage/usage.service.js';
import { InvoicesService } from '../invoice/invoices.service.js';
import { Offering } from '../offering/entities/offeringPackage.entity.js';
import { OfferingType } from '../offering/entities/OfferingType.js';
import { PaymentService } from '../payment/payment.service.js';
import { UserEntitlements } from '../users/entities/entitlement.entity.js';
import { ContractService } from '../contract/contract.service.js';
import { CreateContractDto } from '../contract/dto/createContract.dto.js';
import { CreateContractResponseDto } from '../contract/dto/createContractResponse.dto.js';
import { ReadContractResponseDto } from '../contract/dto/readContract.dto.js';
import { TokenConsumerService } from '../token-consumer/token-consumer.service.js';
import { CustomerEntity } from './entities/customer.entity.js';
import { CustomerGroupService } from '../customergroup/customergroup.service.js';

jest.mock('@influxdata/influxdb-client', () => ({
    Point: jest.fn(() => ({
        tag: jest.fn(),
        stringField: jest.fn(),
    })),
    InfluxDB: jest.fn().mockImplementation(() => ({
        getWriteApi: jest.fn(() => ({ writePoints: jest.fn(), close: jest.fn(), flush: jest.fn() })),
    })),
}));
describe('CustomerService', () => {
    let mockFoundInfluxData: Array<any>;
    let service: CustomerService;
    const mockTag = jest.fn();
    const fakeUsageResponse = [
        {
            dimensionId: '123',
            offeringId: 'currentOffering',
            usage: [{ startTime: '2020-01-01T00:00:00.000Z', endTime: '2020-01-01T00:00:00.000Z', value: '1000' }],
        },
    ];
    const mockGetLatestCustomer = jest.fn(() => mockFoundInfluxData);
    const mockLoadPoints = jest.fn();
    const creditBalance = jest.fn(() => ({ balance: '100.00', customerId: 'fake', message: 'mock call' }));
    const mockFindAllSettings = jest.fn(() => [{ accountState: 'production', stripeConnected: 'notConnected' }]);
    let updatedOffering = {
        data: [
            {
                offeringId: 'superFake',
                dimensions: [],
                offeringName: 'foobar',
                offeringType: OfferingType.subscription,
                subscriptionPrice: 100,
            },
        ],
        message: 'fake message',
    };
    let currentOffering = {
        data: [
            {
                offeringId: 'currentOffering',
                freeTrialLength: '10',
                dimensions: [],
                offeringName: 'foobar',
                offeringType: OfferingType.subscription,
                subscriptionPrice: 100,
            },
        ],
        message: 'fake message',
    };
    const mockFindOneOffering = jest.fn(({ offeringId }: ReadPricingDTO): ReadOfferingResponseDTO => {
        return offeringId === 'currentOffering' ? currentOffering : updatedOffering;
    });
    const mockContractCreate = jest.fn((createContractDto: CreateContractDto): Promise<CreateContractResponseDto> => {
        return Promise.resolve({
            message: 'fake message',
            offeringEnrollmentDate: new Date().toISOString(),
            ...createContractDto,
        });
    });
    const unenrollMock = jest.fn();
    const enrollMock = jest.fn();
    const creditCreateMock = jest.fn();
    const mockStringField = jest.fn();
    let mockFindUsageForCustomer = jest.fn(() => fakeUsageResponse);
    let mockFindInvoicesForCustomer = jest.fn(() => []);
    const mockChangeCustomerContract = jest.fn(() => Promise.resolve({ message: 'fake message' }));
    let influxService;
    let paymentService;
    let offeringInstanceMock;
    let creditService;
    let userEntitlements;
    let contractService;
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [CustomerService],
            imports: [],
        })
            .useMocker((token) => {
                if (token === LocalJWTAuthService) {
                    return {
                        signIn: () => ({ access_token: 'foobar' }),
                        generateStripeState: () => ({ access_token: 'barfoo' }),
                        generateCustomerTokenWithInvoiceId: () => ({ access_token: 'barbar' }),
                    };
                }
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: mockTag, stringField: mockStringField }),
                        getLatestCustomer: mockGetLatestCustomer,
                        getInvoicesForCustomer: mockFindInvoicesForCustomer,
                        getMeteringCoCustomers: jest.fn(),
                    };
                }
                if (token === ContractService) {
                    return {
                        create: mockContractCreate,
                        findOne: jest.fn(({ offeringEnrollmentDate, freeTrialEndDate }) =>
                            Promise.resolve({
                                overridesForOffering: { freeTrialEndDate },
                                offeringEnrollmentDate: offeringEnrollmentDate
                                    ? new Date(offeringEnrollmentDate)
                                    : DatetimeUtils.daysBeforeDate(new Date(), 10000),
                                readOfferingResponseData: {
                                    offeringId: 'currentOffering',
                                    offeringEnrollmentDate: offeringEnrollmentDate
                                        ? new Date(offeringEnrollmentDate)
                                        : DatetimeUtils.daysBeforeDate(new Date(), 10000),
                                } as unknown,
                            } as ReadContractResponseDto),
                        ),
                        changeCustomerContract: mockChangeCustomerContract,
                        enrollCustomerInContract: jest.fn(),
                    };
                }
                if (token === CreditService) {
                    return {
                        findCreditBalance: creditBalance,
                        create: creditCreateMock,
                        getCreditLedger: jest.fn(),
                    };
                }
                if (token === SettingsService) {
                    return {
                        findAll: mockFindAllSettings,
                    };
                }
                if (token === OfferingService) {
                    return {
                        findOne: mockFindOneOffering,
                    };
                }
                if (token === SchedulerService) {
                    return {
                        emitOne: jest.fn(),
                        remove: jest.fn(),
                        create: jest.fn(),
                    };
                }
                if (token === UsageService) {
                    return {
                        findUsageForCustomer: mockFindUsageForCustomer,
                    };
                }
                if (token === InvoicesService) {
                    return {};
                }
                if (token === PaymentService) {
                    return {
                        getAmountPaidForCustomerInvoices: jest.fn(),
                    };
                }
                if (token === UserEntitlements) {
                    return {
                        determineIfEntitlementExceeded: jest.fn(),
                    };
                }
                if (token === TokenConsumerService) {
                    return {
                        create: jest.fn(),
                    };
                }
                if (token === CustomerGroupService) {
                    return {
                        findAllChildRowsForParent: jest.fn(),
                        findOneChildRow: jest.fn(),
                    };
                }
            })
            .compile();
        mockFoundInfluxData = [
            {
                customerId: 'fake',
                customerName: 'fake',
                businessID: 'fake',
                softDelete: false,
                paymentChannel: paymentChannel.manual,
                email: 'fake@fake.com',
                freeTrialEndDate: new Date().toISOString(),
                offeringId: 'currentOffering',
                currency: SupportedCurrencies.USD,
            },
        ];
        service = module.get<CustomerService>(CustomerService);
        updatedOffering = {
            data: [
                {
                    offeringId: 'superFake',
                    dimensions: [],
                    offeringName: 'foobar',
                    offeringType: OfferingType.subscription,
                    subscriptionPrice: '100',
                },
            ],
            message: 'fake message',
        };
        currentOffering = {
            data: [
                {
                    offeringId: 'currentOffering',
                    freeTrialLength: '10',
                    dimensions: [],
                    offeringName: 'foobar',
                    offeringType: OfferingType.subscription,
                    subscriptionPrice: '100',
                },
            ],
            message: 'fake message',
        };
        offeringInstanceMock = jest.spyOn(Offering, 'getInstance').mockImplementation(() => ({
            unenroll: unenrollMock,
            enroll: enrollMock,
        }));
        influxService = module.get(InfluxService);
        paymentService = module.get(PaymentService);
        creditService = module.get(CreditService);
        userEntitlements = module.get<UserEntitlements>(UserEntitlements);
        contractService = module.get<ContractService>(ContractService);
    });

    afterEach(() => {
        jest.clearAllMocks();
        mockFindInvoicesForCustomer = jest.fn(() => []);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('Should return freeTrialEndDate regardless of how far in the past it is', async () => {
        mockFoundInfluxData = [
            {
                ...mockFoundInfluxData[0],
                freeTrialEndDate: DatetimeUtils.daysBeforeDate(new Date(), 1000).toISOString(),
            },
        ];
        const res = await service.findOne({ customerId: 'fake', businessID: 'fake' });
        expect(res.data[0].freeTrialEndDate).toBe(mockFoundInfluxData[0].freeTrialEndDate);
    });

    it('Should return all usage if the offeringEnrollmentDate is not set', async () => {
        const results = await service.findUsageForCustomer({ businessID: 'fake', customerId: 'fake' }, {});

        expect(results).toEqual(expect.objectContaining({ data: fakeUsageResponse, message: expect.anything() }));
    });
    it('Should filter usage response to be set to 0 value if the offering enrollment date is after the startTime on the usage', async () => {
        mockFindUsageForCustomer = jest.fn().mockImplementation(() => fakeUsageResponse);
        mockFoundInfluxData = [{ ...mockFoundInfluxData[0], offeringEnrollmentDate: '2022-01-02T00:00:00.000Z' }];
        const results = await service.findUsageForCustomer({ businessID: 'fake', customerId: 'fake' }, {});

        expect(results).toEqual({
            data: [{ ...fakeUsageResponse[0], usage: [{ ...fakeUsageResponse[0].usage[0], value: '0' }] }],
            message: expect.anything(),
        });
    });

    it('Should return payment and refund arrays for invoices in customer object', async () => {
        jest.spyOn(influxService, 'getInvoicesForCustomer').mockResolvedValueOnce([{ id: 'foobar' }]);
        jest.spyOn(paymentService, 'getAmountPaidForCustomerInvoices').mockResolvedValueOnce([{ id: 'foobar' }]);
        jest.spyOn(creditService, 'getCreditLedger').mockResolvedValueOnce({ data: [], message: 'fake message' });
        const results = await service.findOne({ businessID: 'fake', customerId: 'fake' });
        expect(results.data[0].invoices[0].payments).toEqual([]);
        expect(results.data[0].invoices[0].refunds).toEqual([]);
    });
    it("should not set offeringEnrollmentDate if the customer doesn't have an offeringEnrollmentDate", async () => {
        await service.update({ customerId: 'fake', businessID: 'fake' }, 'fakeUser');
        expect(mockTag).not.toHaveBeenCalledWith('offeringEnrollmentDate', expect.anything());
    });
    it('should set offeringEnrollmentDate if the update includes a new offeringId', async () => {
        jest.spyOn(contractService, 'changeCustomerContract').mockResolvedValueOnce({
            message: 'fake message',
            offeringEnrollmentDate: new Date().toISOString(),
        });
        await service.update({ customerId: 'fake', businessID: 'fake', offeringId: 'foobar' }, 'fakeUser');
        expect(mockTag).toHaveBeenCalledWith('offeringEnrollmentDate', expect.anything());
    });
    it('Should pass along free trial end date and start date from the contract service', async () => {
        jest.spyOn(contractService, 'changeCustomerContract').mockResolvedValueOnce({
            message: 'fake message',
            offeringEnrollmentDate: new Date().toISOString(),
            freeTrialEndDate: new Date().toISOString(),
            freeTrialStartDate: new Date().toISOString(),
        });
        await service.update({ customerId: 'fake', businessID: 'fake', offeringId: 'foobar' }, 'fakeUser');
        expect(mockTag).toHaveBeenCalledWith('freeTrialEndDate', expect.anything());
        expect(mockTag).toHaveBeenCalledWith('freeTrialStartDate', expect.anything());
    });
    it('Should use the prior values from the customer in a case where no offeringId is included', async () => {
        mockFoundInfluxData = [
            {
                ...mockFoundInfluxData[0],
                freeTrialStartDate: new Date().toISOString(),
                offeringEnrollmentDate: new Date().toISOString(),
            },
        ];
        await service.update({ customerId: 'fake', businessID: 'fake', customerName: 'foobar' }, 'fakeUser');
        expect(mockTag).toHaveBeenCalledWith('freeTrialEndDate', expect.anything());
        expect(mockTag).toHaveBeenCalledWith('freeTrialStartDate', expect.anything());
        expect(mockTag).toHaveBeenCalledWith('offeringEnrollmentDate', expect.anything());
        expect(mockStringField).toHaveBeenCalledWith('customerName', 'foobar');
        expect(contractService.changeCustomerContract).not.toHaveBeenCalled();
    });
    it('should put credit and payments into the invoice correctly by invoiceId', async () => {
        jest.spyOn(influxService, 'getInvoicesForCustomer').mockResolvedValueOnce([
            { invoiceId: 'foobar' },
            { invoiceId: 'barfoo' },
        ]);
        jest.spyOn(paymentService, 'getAmountPaidForCustomerInvoices').mockResolvedValueOnce([
            { id: 'foobar', amount: 100 },
        ]);
        const timestamp = new Date();
        jest.spyOn(creditService, 'getCreditLedger').mockResolvedValueOnce({
            data: [
                { metadata: { invoiceId: 'foobar' }, transactionAmount: 100, timestamp },
                { transactionAmount: 1337, timestamp, metadata: { invoiceId: 'barfoo' } },
            ],
            message: 'fake message',
        });
        const results = await service.findOne({ businessID: 'fake', customerId: 'fake' });
        expect(results.data[0].invoices[0].payments).toEqual([
            expect.objectContaining({
                transactionAmount: '100.00',
                timestamp: timestamp.toISOString(),
                metadata: { invoiceId: 'foobar' },
            }),
        ]);
        expect(results.data[0].invoices[1].payments).toEqual([
            expect.objectContaining({
                transactionAmount: '1337.00',
                timestamp: timestamp.toISOString(),
                metadata: { invoiceId: 'barfoo' },
            }),
        ]);
    });
    it('Should not create a customer if entitlements are breached', async () => {
        jest.spyOn(userEntitlements, 'determineIfEntitlementExceeded').mockResolvedValueOnce({
            entitlementExceeded: true,
            entitlementValue: '100',
            currentValue: '101',
        });
        await expect(
            service.create(
                {
                    offeringId: 'bar',
                    customerName: 'foo',
                    email: 'farboo@barfoo.com',
                    paymentChannel: paymentChannel.manual,
                },
                'fakeUser',
            ),
        ).rejects.toThrowError();
        expect(mockTag).not.toHaveBeenCalled();
    });
    it('Should add prepaid credit to the credit amount if the contract service returns prepaid credit', async () => {
        jest.spyOn(contractService, 'changeCustomerContract').mockResolvedValueOnce({
            message: 'fake message',
            offeringEnrollmentDate: new Date().toISOString(),
            freeTrialEndDate: new Date().toISOString(),
            freeTrialStartDate: new Date().toISOString(),
            prepaidCredit: '100',
        });
        await service.update({ customerId: 'fake', businessID: 'fake', offeringId: 'foobar' }, 'fakeUser');
        expect(mockTag).toHaveBeenCalledWith('creditBalance', '200.00');
    });
    it('Should not add prepaid credit to the credit amount if the contract service doesnt return prepaid credit', async () => {
        jest.spyOn(contractService, 'changeCustomerContract').mockResolvedValueOnce({
            message: 'fake message',
            offeringEnrollmentDate: new Date().toISOString(),
            freeTrialEndDate: new Date().toISOString(),
            freeTrialStartDate: new Date().toISOString(),
        });
        await service.update({ customerId: 'fake', businessID: 'fake', offeringId: 'foobar' }, 'fakeUser');
        // The credit balance is 100 because the mock credit balance is 100
        expect(mockTag).toHaveBeenCalledWith('creditBalance', '100.00');
    });
    it('Should store multiple offeringIds when removePriorOffering is set to false', async () => {
        jest.spyOn(contractService, 'changeCustomerContract').mockResolvedValueOnce({
            message: 'fake message',
            offeringEnrollmentDate: new Date().toISOString(),
            freeTrialEndDate: new Date().toISOString(),
            freeTrialStartDate: new Date().toISOString(),
        });
        await service.update(
            { customerId: 'fake', businessID: 'fake', offeringId: 'foobar', removePriorOffering: false },
            'fakeUser',
        );
        expect(mockTag).toHaveBeenCalledWith('offeringIds', JSON.stringify(['foobar', 'currentOffering']));
        expect(mockTag).toHaveBeenCalledWith('offeringId', 'foobar');
    });
    it('Should store a single offeringId when removePriorOffering is set to true', async () => {
        jest.spyOn(contractService, 'changeCustomerContract').mockResolvedValueOnce({
            message: 'fake message',
            offeringEnrollmentDate: new Date().toISOString(),
            freeTrialEndDate: new Date().toISOString(),
            freeTrialStartDate: new Date().toISOString(),
        });
        await service.update(
            { customerId: 'fake', businessID: 'fake', offeringId: 'foobar', removePriorOffering: true },
            'fakeUser',
        );
        expect(mockTag).toHaveBeenCalledWith('offeringIds', JSON.stringify(['foobar']));
        expect(mockTag).toHaveBeenCalledWith('offeringId', 'foobar');
    });

    it('Should create customers if entitlements are not breached', async () => {
        jest.spyOn(userEntitlements, 'determineIfEntitlementExceeded').mockResolvedValueOnce({
            entitlementExceeded: false,
            entitlementValue: '100',
            currentValue: '99',
        });
        await expect(
            service.create(
                {
                    offeringId: 'bar',
                    customerName: 'foo',
                    email: 'farboo@barfoo.com',
                    paymentChannel: paymentChannel.manual,
                },
                'fakeUser',
            ),
        ).resolves.toBeDefined();
        expect(mockTag).toHaveBeenCalled();
    });
    it('Should return all usage regardless of entitlements', async () => {
        jest.spyOn(userEntitlements, 'determineIfEntitlementExceeded').mockResolvedValueOnce({
            entitlementExceeded: true,
            entitlementValue: '100',
            currentValue: '101',
        });
        const results = await service.findUsageForCustomer({ businessID: 'fake', customerId: 'fake' }, {});

        expect(results).toEqual(expect.objectContaining({ data: fakeUsageResponse, message: expect.anything() }));
        expect(userEntitlements.determineIfEntitlementExceeded).not.toHaveBeenCalled();
    });

    it('Should return customers on findOne regardless of entitlements', async () => {
        jest.spyOn(userEntitlements, 'determineIfEntitlementExceeded').mockResolvedValueOnce({
            entitlementExceeded: true,
            entitlementValue: '100',
            currentValue: '101',
        });
        mockFoundInfluxData = [
            {
                ...mockFoundInfluxData[0],
                freeTrialEndDate: DatetimeUtils.daysBeforeDate(new Date(), 1000).toISOString(),
            },
        ];
        await expect(service.findOne({ customerId: 'fake', businessID: 'fake' })).resolves.toBeDefined();
        expect(userEntitlements.determineIfEntitlementExceeded).not.toHaveBeenCalled();
    });

    describe('CustomerEntity', () => {
        it('should preserve order for offeringIds on helper function', () => {
            const ids = CustomerEntity.determineOfferingIdsArray({
                oldOfferingIds: ['new', 'middle', 'oldest'],
                newOfferingId: 'newest',
                removedOfferings: ['middle'],
            });
            expect(ids).toEqual(['newest', 'new', 'oldest']);
            const ids2 = CustomerEntity.determineOfferingIdsArray({
                oldOfferingIds: ['new', 'middle', 'oldest'],
                newOfferingId: 'newest',
                removedOfferings: ['oldest'],
            });
            expect(ids2).toEqual(['newest', 'new', 'middle']);
            const ids3 = CustomerEntity.determineOfferingIdsArray({
                oldOfferingIds: ['new', 'middle', 'oldest'],
                newOfferingId: 'newest',
                removedOfferings: ['new'],
            });
            expect(ids3).toEqual(['newest', 'middle', 'oldest']);
            const ids4 = CustomerEntity.determineOfferingIdsArray({
                oldOfferingIds: ['new', 'middle', 'oldest'],
                newOfferingId: 'newest',
                removedOfferings: ['new', 'middle', 'oldest'],
            });
            expect(ids4).toEqual(['newest']);

            const ids5 = CustomerEntity.determineOfferingIdsArray({
                oldOfferingIds: ['new', 'middle', 'oldest'],
                newOfferingId: 'newest',
                removedOfferings: [],
            });
            expect(ids5).toEqual(['newest', 'new', 'middle', 'oldest']);
        });
    });
});
