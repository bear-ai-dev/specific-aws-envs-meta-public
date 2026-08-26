import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { InfluxService } from '../influx/influx.service.js';
import { EnvironmentService } from './users.service.js';
import { Environment } from './dto/Environment.js';
import { EnvironmentEntity } from './entities/environment.entity.js';
import { cache as cacheManager } from '../cacheStore.js';

jest.mock('../cacheStore');

const SUBJECT = 'auth0|person';

describe('EnvironmentService', () => {
    let environmentService: EnvironmentService;
    let loadPoints: jest.Mock;
    let readCurrentUserEnv: jest.Mock;
    let tag: jest.Mock;
    let stringField: jest.Mock;

    beforeEach(async () => {
        loadPoints = jest.fn();
        tag = jest.fn();
        stringField = jest.fn();
        readCurrentUserEnv = jest.fn(() => []);
        const module: TestingModule = await Test.createTestingModule({
            providers: [EnvironmentService],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints,
                        readCurrentUserEnv,
                        getPoint: jest.fn(() => ({ tag, stringField })),
                    };
                }
            })
            .compile();
        environmentService = module.get<EnvironmentService>(EnvironmentService);
        cacheManager.del = jest.fn();
    });
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('defaults to production when the user has never chosen an environment', async () => {
        const { environment } = await environmentService.getCurrentEnvironment(SUBJECT);
        expect(environment).toEqual(Environment.PRODUCTION);
    });

    it('returns the environment the user last chose', async () => {
        readCurrentUserEnv.mockImplementation(() => [
            {
                subject: SUBJECT,
                _field: 'environment',
                _value: Environment.SANDBOX,
                _measurement: EnvironmentEntity._measurement,
                _time: new Date().toISOString(),
            },
        ]);
        const { environment } = await environmentService.getCurrentEnvironment(SUBJECT);
        expect(environment).toEqual(Environment.SANDBOX);
    });

    it('writes the chosen environment and drops the account cached against the subject', async () => {
        const response = await environmentService.update({
            userSubject: SUBJECT,
            environment: Environment.SANDBOX,
        });

        expect(response.environment).toEqual(Environment.SANDBOX);
        expect(response.subject).toEqual(SUBJECT);
        expect(loadPoints).toBeCalledTimes(1);
        expect(tag).toBeCalledWith('subject', SUBJECT);
        expect(stringField).toBeCalledWith('environment', Environment.SANDBOX);
        // Without this the caller would keep the environment they were in until
        // the cached entry expired.
        expect(cacheManager.del).toBeCalledWith(SUBJECT);
    });

    it('refuses to move an unnamed user', async () => {
        await expect(
            environmentService.update({ userSubject: undefined, environment: Environment.SANDBOX }),
        ).rejects.toThrow(BadRequestException);
        expect(loadPoints).not.toBeCalled();
    });
});
