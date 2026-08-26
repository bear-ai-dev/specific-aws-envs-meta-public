import { Test, TestingModule } from '@nestjs/testing';
import { forwardRef } from '@nestjs/common';
import { InfluxModule } from '../influx/influx.module.js';
import { SchedulerModule } from '../scheduler/scheduler.module.js';
import { MeasurementConfigService } from './measurement-config.service.js';
import { PrivateAPIDimensionsModule } from '../dimensions/dimensions.module.js';
import { measurementMode } from './dto/create-measurement-config.dto.js';
import {
    InfrastructureAccessInformation,
    supportedCloudPlatforms,
    SupportedResources,
} from './entities/measurement-config.entity.js';
import { InfluxService } from '../influx/influx.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { DimensionsService } from '../dimensions/dimensions.service.js';
import { dataBasedUnits, roundingEnum } from '../dimensions/dto/create-dimension.dto.js';
import { createMock } from '@golevelup/ts-jest';

describe('MeasurementConfigService', () => {
    let service: MeasurementConfigService;
    // const client = createClient();
    // afterAll(async () => {
    //     await client.quit();
    // });
    const fakeSubject = 'fakeSubject';
    const mockInfrastructureMeasurementInput = {
        measurementConfiguration: new InfrastructureAccessInformation({
            iamRoleArn: 'fakeARN',
            externalId: 'fakeID',
            cloudPlatform: supportedCloudPlatforms.aws,
            region: 'us-east-1',
            resourceType: SupportedResources.k8sPod,
        }),
        measurementMode: measurementMode.infrastructureBased,
        dimensionIds: ['1234'],
        businessID: 'fakeBusiness',
    };
    const mockEBSInfraMeasurement = {
        measurementConfiguration: new InfrastructureAccessInformation({
            iamRoleArn: 'fakeARN',
            externalId: 'fakeID',
            cloudPlatform: supportedCloudPlatforms.aws,
            region: 'us-east-1',
            resourceType: SupportedResources.ebs,
        }),
        measurementMode: measurementMode.infrastructureBased,
        dimensionIds: ['1234'],
        businessID: 'fakeBusiness',
    };
    const mockEBSSnapshots = {
        measurementConfiguration: new InfrastructureAccessInformation({
            iamRoleArn: 'fakeARN',
            externalId: 'fakeID',
            cloudPlatform: supportedCloudPlatforms.aws,
            region: 'us-east-1',
            resourceType: SupportedResources.ebssnapshot,
        }),
        measurementMode: measurementMode.infrastructureBased,
        dimensionIds: ['1234'],
        businessID: 'fakeBusiness',
    };
    const mockLoadPoints = jest.fn();
    const mockCreateSchedules = jest.fn();
    const mockTransformDTOtoEntityInput = jest.fn();
    const mockFindOneByDimensionId = jest.fn();
    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [MeasurementConfigService],
            imports: [],
        })
            .useMocker(createMock)
            .useMocker((token) => {
                if (token === InfluxService) {
                    return {
                        loadPoints: mockLoadPoints,
                        getPoint: () => ({ tag: jest.fn(), stringField: jest.fn() }),
                        readMeasurementConfigDataByDimensionId: () => [],
                    };
                }
                if (token === DimensionsService) {
                    return {
                        transformDtoToEntityInput: mockTransformDTOtoEntityInput,
                        findOneByDimensionId: mockFindOneByDimensionId,
                    };
                }
            })
            .compile();

        service = module.get<MeasurementConfigService>(MeasurementConfigService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });
    it('should be defined', () => {
        expect(service).toBeDefined();
    });
});
