import { BadRequestException } from '@nestjs/common';
import { cache as cacheManager } from '../cacheStore.js';
import { Environment } from './dto/Environment.js';
import { EnvironmentEntity } from './entities/environment.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { EnvironmentService } from './users.service.js';

jest.mock('../cacheStore');

describe('EnvironmentService', () => {
    const subject = 'auth0|operator';
    const environmentRows = [
        {
            subject,
            businessID: 'harborline',
            environment: Environment.PRODUCTION,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
        {
            subject,
            businessID: 'harborline-sandbox',
            environment: Environment.SANDBOX,
            _measurement: UserEntity._measurementActiveEnvironment,
            _field: 'userStatus',
            _value: 'live',
            _time: new Date().toISOString(),
        },
    ];
    const mockTag = jest.fn();
    const mockStringField = jest.fn();
    let loadPoints: jest.Mock;
    let readAllEnvironmentsForUser: jest.Mock;
    let environmentService: EnvironmentService;

    beforeEach(() => {
        loadPoints = jest.fn();
        readAllEnvironmentsForUser = jest.fn(async () => environmentRows);
        environmentService = new EnvironmentService({
            loadPoints,
            readAllEnvironmentsForUser,
            getPoint: () => ({ tag: mockTag, stringField: mockStringField }),
        } as any);
        cacheManager.del = jest.fn();
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should move the user to the chosen environment', async () => {
        const { environment, subject: updatedSubject } = await environmentService.updateEnvironment({
            subject,
            environment: Environment.SANDBOX,
        });
        expect(environment).toBe(Environment.SANDBOX);
        expect(updatedSubject).toBe(subject);
        expect(loadPoints).toBeCalledTimes(1);
        expect(mockTag).toBeCalledWith('subject', subject);
        expect(mockStringField).toBeCalledWith('environment', Environment.SANDBOX);
    });

    it('should take effect on the very next request', async () => {
        await environmentService.updateEnvironment({ subject, environment: Environment.SANDBOX });
        expect(cacheManager.del).toBeCalledWith(subject);
    });

    it('should refuse an environment the user does not hold', async () => {
        readAllEnvironmentsForUser.mockImplementation(async () => [environmentRows[0]]);
        await expect(
            environmentService.updateEnvironment({ subject, environment: Environment.SANDBOX }),
        ).rejects.toThrow(BadRequestException);
        expect(loadPoints).not.toBeCalled();
    });

    it('should write the current environment against the active environment measurement', async () => {
        const getPoint = jest.fn(() => ({ tag: mockTag, stringField: mockStringField }));
        environmentService = new EnvironmentService({
            loadPoints,
            readAllEnvironmentsForUser,
            getPoint,
        } as any);
        await environmentService.updateEnvironment({ subject, environment: Environment.PRODUCTION });
        expect(getPoint).toBeCalledWith(EnvironmentEntity._measurement);
    });
});
