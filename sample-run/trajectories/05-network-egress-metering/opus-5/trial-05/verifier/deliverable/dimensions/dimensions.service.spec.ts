import { Test, TestingModule } from '@nestjs/testing';
import { DimensionsService } from './dimensions.service.js';
import { createMock } from '@golevelup/ts-jest';
import { MeasurementConfigService } from '../measurement-config/measurement-config.service.js';
import { SchedulerService } from '../scheduler/scheduler.service.js';
import { measurementMode } from '../measurement-config/dto/create-measurement-config.dto.js';
import { SupportedResources } from '../measurement-config/entities/measurement-config.entity.js';
import { infrastructureType } from './dto/create-dimension.dto.js';
import { SupportedMeasurementFrequencies, schedulerType } from '../scheduler/dto/scheduler.dto.js';

describe('DimensionsService', () => {
    let service: DimensionsService;
    let measurementConfigService: MeasurementConfigService;
    let schedulerService: SchedulerService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [DimensionsService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<DimensionsService>(DimensionsService);
        measurementConfigService = module.get<MeasurementConfigService>(MeasurementConfigService);
        schedulerService = module.get<SchedulerService>(SchedulerService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('infrastructure based dimensions', () => {
        const measurementId = 'measurementOne';
        const businessID = 'myCoolCorp';
        const createDimensionDto: any = {
            name: 'Egress',
            businessID,
            measurementId,
            consumptionPrice: '0.1',
            usageIncrement: '1',
            consumptionUnit: { unit: 'byte', type: 'data' },
        };

        const measurementConfigurationFor = (resourceType) => ({
            data: [
                {
                    measurementId,
                    measurementMode: measurementMode.infrastructureBased,
                    measurementConfiguration: {
                        iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-egress-reader',
                        externalId: 'nw-sbx-4417',
                        region: 'us-east-1',
                        resourceType,
                    },
                },
            ],
        });

        beforeEach(() => {
            jest.spyOn(measurementConfigService, 'createMeasurementConfig').mockImplementation(
                async (dto, id, business, dimensionId) => service.transformDtoToEntityInput(dto, dimensionId),
            );
        });

        it('dispatches network out gathering every five minutes for an ec2 network out measurement', async () => {
            jest.spyOn(measurementConfigService, 'findOne').mockResolvedValue(
                measurementConfigurationFor(SupportedResources.ec2NetworkOut) as any,
            );
            const scheduler = jest.spyOn(schedulerService, 'create').mockResolvedValue({} as any);

            await service.create(createDimensionDto, 'mySubject');

            expect(scheduler).toHaveBeenCalledTimes(1);
            const [schedule] = scheduler.mock.calls[0];
            expect(schedule.schedulerType).toBe(schedulerType.dimensionDataGathering);
            expect(schedule.rate).toBe(SupportedMeasurementFrequencies.everyFiveMinutes);
            expect(schedule.scheduleParameters).toMatchObject({
                dimensionType: infrastructureType.instanceNetworkOut,
                iamRoleArn: 'arn:aws:iam::100000000031:role/meteringco-egress-reader',
                externalId: 'nw-sbx-4417',
                region: 'us-east-1',
            });
        });

        it('dispatches running time gathering for an ec2 measurement', async () => {
            jest.spyOn(measurementConfigService, 'findOne').mockResolvedValue(
                measurementConfigurationFor(SupportedResources.ec2) as any,
            );
            const scheduler = jest.spyOn(schedulerService, 'create').mockResolvedValue({} as any);

            await service.create(createDimensionDto, 'mySubject');

            expect(scheduler.mock.calls[0][0].scheduleParameters).toMatchObject({
                dimensionType: infrastructureType.instanceRunningTime,
            });
        });
    });
});
