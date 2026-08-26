import { Test, TestingModule } from '@nestjs/testing';
import { createMock } from '@golevelup/ts-jest';
import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';

describe('Ec2NetworkOutDataGathererService', () => {
    let service: Ec2NetworkOutDataGathererService;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [Ec2NetworkOutDataGathererService],
        })
            .useMocker(createMock)
            .compile();

        service = module.get<Ec2NetworkOutDataGathererService>(Ec2NetworkOutDataGathererService);
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    it('rejects a run which does not say which role to assume', async () => {
        await expect(
            service.readOperationJob({
                data: { scheduleParameters: { dimensionId: 'someDimension' }, businessID: 'someBusiness' },
            } as any),
        ).rejects.toThrow('Iam role arn not found');
    });

    it('meters a machine only when it names a customer and lists the dimension', () => {
        const isMetered = (Ec2NetworkOutDataGathererService as any).isMeteredOnDimension;
        const instance = (tags) => ({ Tags: Object.entries(tags).map(([Key, Value]) => ({ Key, Value })) });

        expect(isMetered(instance({ meteringcoDimensionId: 'dimA', meteringcoCustomerId: 'customerA' }), 'dimA')).toBe(true);
        // Several dimensions on one machine, comma separated
        expect(
            isMetered(instance({ meteringcoDimensionId: 'dimB, dimA ,dimC', meteringcoCustomerId: 'customerA' }), 'dimA'),
        ).toBe(true);
        // No customer tag
        expect(isMetered(instance({ meteringcoDimensionId: 'dimA' }), 'dimA')).toBe(false);
        // The list does not hold the dimension this run is for
        expect(isMetered(instance({ meteringcoDimensionId: 'dimB,dimC', meteringcoCustomerId: 'customerA' }), 'dimA')).toBe(
            false,
        );
        expect(isMetered({ Tags: undefined }, 'dimA')).toBe(false);
    });
});
