import { Test, TestingModule } from '@nestjs/testing';
import { InfluxService } from '../influx/influx.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UserEntity } from './entities/user.entity.js';
import { EnvironmentService, OrganizationService, UsersService } from './users.service.js';
import { cache as cacheManager } from '../cacheStore.js';
import { Environment } from './dto/Environment.js';
import { UserActiveEnvironment } from '../influx/entities/userTable.entity.js';
import { EnvironmentEntity } from './entities/environment.entity.js';
import { createMock } from '@golevelup/ts-jest';
import { PublicAPIOfferingModule } from '../offering/offering.module.js';
import { OfferingService } from '../offering/offering.service.js';
import { UserEntitlements } from './entities/entitlement.entity.js';
jest.mock('../cacheStore');
const cacheMock = cacheManager;
describe('UsersService', () => {
    const mockData: CreateUserDto = {
        subject: 'auth0|testtesttest',
        businessID: 'myCoolCorp',
    };
    const mockFoundInfluxData: Array<any> = [
        {
            subject: 'auth0|testtesttest',
            _value: 'live',
            _field: 'userStatus',
            businessID: 'myCoolCorp',
            _measurement: UserEntity._measurement,
            _time: new Date().toISOString(),
            environment: Environment.PRODUCTION,
        },
    ];
    const mockEnvInfluxData: Array<UserActiveEnvironment> = [
        {
            subject: 'auth0|testtesttest',
            _value: Environment.PRODUCTION,
            _field: 'environment',
            _measurement: EnvironmentEntity._measurement,
            _time: new Date().toISOString(),
        },
    ];
    const mockTag = jest.fn();
    const mockLoadPoints = jest.fn();
    let mockReadUserData: jest.Mock;
    let mockReadCurrentUserEnv: jest.Mock;
    let userService: UsersService;
    let environmentService: EnvironmentService;
    beforeEach(async () => {
        mockReadUserData = jest.fn(() => mockFoundInfluxData);
        mockReadCurrentUserEnv = jest.fn(() => mockEnvInfluxData);
        const module: TestingModule = await Test.createTestingModule({
            providers: [UsersService, OrganizationService, EnvironmentService],
            imports: [],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: mockTag, stringField: jest.fn() }),
                        readUserData: mockReadUserData,
                        readCurrentUserEnv: mockReadCurrentUserEnv,
                        getMeteringCoCustomers: jest.fn(),
                    };
                }
                if (token === OfferingService) {
                    return {
                        findOne: jest.fn(),
                    };
                }
                if (token === UserEntitlements) {
                    return {
                        determineIfEntitlementExceeded: jest.fn(),
                    };
                }
            })
            .compile();

        userService = module.get<UsersService>(UsersService);
        environmentService = module.get<EnvironmentService>(EnvironmentService);
        cacheMock.set = jest.fn();
        cacheMock.get = jest.fn();
        cacheMock.del = jest.fn();
    });
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(userService).toBeDefined();
    });
    it('Should load user data if called correctly', async () => {
        const { message } = await userService.create(mockData);
        expect(message).toBeDefined();

        expect(mockLoadPoints).toBeCalledTimes(1);
    });
    it('Should return the correct user data', async () => {
        const {
            data: [userEntity],
        } = await userService.findOne({ subject: mockData.subject });

        expect(mockReadUserData).toBeCalledTimes(1);
        expect(mockReadUserData).toBeCalledWith(mockData.subject, Environment.PRODUCTION);
        expect(userEntity.subject).toBe(mockData.subject);
        expect(userEntity.businessID).toBe(`${mockData.businessID}`);
    });
    it('should set the environment correctly', async () => {
        const { environment } = await environmentService.update({
            userSubject: mockData.subject,
            environment: Environment.SANDBOX,
        });

        expect(environment).toBe(Environment.SANDBOX);

        expect(mockLoadPoints).toBeCalledTimes(1);
        // Once for getting the actual user
        expect(cacheMock.get).toBeCalledTimes(1);
    });
    it('should return production as the env if none is set', async () => {
        const {
            data: [userEntity],
        } = await userService.findOne({ subject: mockData.subject });
        expect(userEntity.environment).toBe(Environment.PRODUCTION);
    });
    it('should return the correct env if one is set', async () => {
        mockReadCurrentUserEnv.mockImplementation(() => [
            {
                subject: 'auth0|testtesttest',
                _value: Environment.SANDBOX,
                _field: 'environment',
                _measurement: EnvironmentEntity._measurement,
                _time: new Date().toISOString(),
            },
        ]);
        mockReadUserData.mockImplementation(() => [
            {
                subject: 'auth0|testtesttest',
                environment: 'sandbox',
                _field: 'userStatus',
                businessID: 'myCoolCorp-sandbox',
                _measurement: UserEntity._measurement,
                _time: new Date().toISOString(),
            },
        ]);
        const {
            data: [userEntity],
        } = await userService.findOne({ subject: mockData.subject });
        expect(userEntity.environment).toBe(Environment.SANDBOX);
        expect(userEntity.businessID).toBe(`${mockData.businessID}-sandbox`);
    });
});
