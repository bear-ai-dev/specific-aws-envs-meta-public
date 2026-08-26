import { Ec2NetworkOutDataGathererService } from './ec2NetworkOutDataGatherer.service.js';
import { SupportedMeasurementFrequencies } from '../../scheduler/dto/scheduler.dto.js';

const instance = (InstanceId: string, tags: Record<string, string>, state = 'running') => ({
    InstanceId,
    State: { Name: state },
    Tags: Object.keys(tags).map((Key) => ({ Key, Value: tags[Key] })),
});

describe('Ec2NetworkOutDataGathererService', () => {
    describe('filterInstancesForDimension', () => {
        it('keeps instances tagged with the dimension of the run and a customer', () => {
            const instances = [
                instance('i-1', { meteringcoDimensionId: 'dim-1', meteringcoCustomerId: 'customer-1' }),
                instance('i-2', { meteringcoDimensionId: 'dim-2,dim-1', meteringcoCustomerId: 'customer-2' }),
                instance('i-3', { meteringcoDimensionId: ' dim-1 , dim-3 ', meteringcoCustomerId: 'customer-3' }),
            ];
            const results = Ec2NetworkOutDataGathererService.filterInstancesForDimension(instances, 'dim-1');
            expect(results.map(({ InstanceId }) => InstanceId)).toEqual(['i-1', 'i-2', 'i-3']);
        });
        it('keeps instances which are no longer running', () => {
            const instances = [
                instance('i-1', { meteringcoDimensionId: 'dim-1', meteringcoCustomerId: 'customer-1' }, 'stopped'),
                instance('i-2', { meteringcoDimensionId: 'dim-1', meteringcoCustomerId: 'customer-1' }, 'terminated'),
            ];
            const results = Ec2NetworkOutDataGathererService.filterInstancesForDimension(instances, 'dim-1');
            expect(results.map(({ InstanceId }) => InstanceId)).toEqual(['i-1', 'i-2']);
        });
        it('drops instances without a customer, or which are not metered on the dimension', () => {
            const instances = [
                instance('i-1', { meteringcoDimensionId: 'dim-1' }),
                instance('i-2', { meteringcoDimensionId: 'dim-1', meteringcoCustomerId: '' }),
                instance('i-3', { meteringcoDimensionId: 'dim-2', meteringcoCustomerId: 'customer-3' }),
                instance('i-4', { meteringcoDimensionId: 'dim-11', meteringcoCustomerId: 'customer-4' }),
                instance('i-5', { meteringcoCustomerId: 'customer-5' }),
            ];
            expect(Ec2NetworkOutDataGathererService.filterInstancesForDimension(instances, 'dim-1')).toEqual([]);
            expect(Ec2NetworkOutDataGathererService.filterInstancesForDimension(undefined, 'dim-1')).toEqual([]);
        });
    });

    describe('getMeasurementWindow', () => {
        it('reads back over the interval of the run and the lag of the observations', () => {
            const { startTime, endTime, periodInSeconds } = Ec2NetworkOutDataGathererService.getMeasurementWindow(
                SupportedMeasurementFrequencies.everyFiveMinutes,
            );
            expect(periodInSeconds).toBe(300);
            expect(endTime.getTime() - startTime.getTime()).toBe(600000);
        });
        it('never reads back less than the minimum lookback', () => {
            const { startTime, endTime } = Ec2NetworkOutDataGathererService.getMeasurementWindow(
                SupportedMeasurementFrequencies.perMinute,
            );
            expect(endTime.getTime() - startTime.getTime()).toBe(Ec2NetworkOutDataGathererService.minimumLookbackInMS);
        });
    });
});
