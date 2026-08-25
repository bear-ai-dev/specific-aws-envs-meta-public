import { UserTable } from '../../../src/influx/entities/userTable.entity';
import { UserTableValue } from '../data/user';

const mockLoadPoints = jest.fn();
const mockTag = jest.fn();
const mockStringField = jest.fn();
const mockGetLatestCustomers = jest.fn(async () => []);
const mockGetLatestCustomer = jest.fn(async () => []);
const mockGetLatestSettings = jest.fn(async () => []);
const mockGetCustomerContracts = jest.fn(async () => []);
const mockGetAllOfferingIds = jest.fn(async () => []);
const mockgetAllInvoicesGroupedByCustomer = jest.fn(async () => []);
const mockReadEnvironmentForBusiness = jest.fn(async ({ businessID }): Promise<UserTable[]> => {
    return UserTableValue;
});
const getInvoicesForCustomer = jest.fn(async () => []);
const calculateCreditTotal = jest.fn(async () => []);
const mockReadAllEnvironmentsForUser = jest.fn(async (): Promise<UserTable[]> => UserTableValue);
const mockGetMeteringCoCustomers = jest.fn(async () => [
    {
        customerId: '123',
        businessID: 'meteringco-production',
        metadata: JSON.stringify({ businessID: 'foobar-production' }),
    },
]);
const mockGetAllLatestHooksByType = jest.fn(async () => []);
const mockGetLatestOfferingConfig = jest.fn(async () => []);
const mockGetSingleDimension = jest.fn(async () => []);
const mockGetSingleInvoice = jest.fn(async () => []);
const mockGetLatestCustomerContract = jest.fn(async () => []);
const mockGetAggregateUsageForDimension = jest.fn(async () => []);
const mockGetMeteringCoOffering = jest.fn(async () => ({ offering: { offeringId: '123' }, dimensions: [] }));
const mockCalculateAllCreditTotal = jest.fn(async () => []);
const mockGetAllOfferingConfigs = jest.fn(async () => []);
const mockGetAllDimensions = jest.fn(async () => []);
const mcokReadAllMeaurements = jest.fn(async () => []);
const mockQueryForLedger = jest.fn(async () => []);
export class MockInfluxService {
    loadPoints;
    getPoint;
    getLatestCustomers;
    getLatestCustomer;
    readEnvironmentForBusiness;
    getLatestSettings;
    getCustomerContracts;
    getAllOfferingIds;
    getLatestOfferingConfig;
    getAllInvoicesGroupedByCustomer;
    getInvoicesForCustomer;
    calculateCreditTotal;
    readAllEnvironmentsForUser;
    getMeteringCoCustomers;
    getAllLatestHooksByType;
    getSingleDimension;
    getSingleInvoice;
    getLatestCustomerContract;
    getAggregateUsageForDimension;
    getMeteringCoOffering;
    calculateAllCreditTotal;
    getAllOfferingConfigs;
    getAllDimensions;
    readAllMeaurements;
    queryForLedger;
    constructor() {
        this.loadPoints = mockLoadPoints;
        this.getPoint = () => ({
            tag: mockTag,
            stringField: mockStringField,
            timestamp: jest.fn(),
            floatField: jest.fn(),
        });
        this.getLatestCustomers = mockGetLatestCustomers;
        this.getLatestCustomer = mockGetLatestCustomer;
        this.readEnvironmentForBusiness = mockReadEnvironmentForBusiness;
        this.getLatestSettings = mockGetLatestSettings;
        this.getCustomerContracts = mockGetCustomerContracts;
        this.getAllOfferingIds = mockGetAllOfferingIds;
        this.getAllInvoicesGroupedByCustomer = mockgetAllInvoicesGroupedByCustomer;
        this.getInvoicesForCustomer = getInvoicesForCustomer;
        this.calculateCreditTotal = calculateCreditTotal;
        this.readAllEnvironmentsForUser = mockReadAllEnvironmentsForUser;
        this.getMeteringCoCustomers = mockGetMeteringCoCustomers;
        this.getAllLatestHooksByType = mockGetAllLatestHooksByType;
        this.getLatestOfferingConfig = mockGetLatestOfferingConfig;
        this.getSingleDimension = mockGetSingleDimension;
        this.getSingleInvoice = mockGetSingleInvoice;
        this.getLatestCustomerContract = mockGetLatestCustomerContract;
        this.getAggregateUsageForDimension = mockGetAggregateUsageForDimension;
        this.getMeteringCoOffering = mockGetMeteringCoOffering;
        this.calculateAllCreditTotal = mockCalculateAllCreditTotal;
        this.getAllOfferingConfigs = mockGetAllOfferingConfigs;
        this.getAllDimensions = mockGetAllDimensions;
        this.readAllMeaurements = mcokReadAllMeaurements;
        this.queryForLedger = mockQueryForLedger;
    }
}
