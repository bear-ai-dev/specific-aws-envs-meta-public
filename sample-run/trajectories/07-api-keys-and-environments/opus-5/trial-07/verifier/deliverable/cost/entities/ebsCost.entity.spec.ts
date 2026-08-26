import { supportedEBSTypes } from '../dto/cost.dto.js';

import {
    EBSCostEntity,
    IOPSUnitCostRanges,
    ThroughPutUnitCostRanges,
    StorageUnitCostRanges,
    CalculatedEbsCostEntity,
} from './ebsCost.entity.js';
import { InternalServerErrorException } from '@nestjs/common';

describe('Cost entity', () => {
    it('should be defined', () => {
        expect(true).toEqual(true);
    });

    /**
     *
     * The cost calculation below is derived from the AWS Pricing API and more specifically the cost calculator page
     * https://calculator.aws/#/estimate?id=931e77153b89f6f3fb1e042e143b16bda3d3559e
     * Look into the specifics of how the calculator works to understand the cost calculation below
     */
    describe('Calculate cost function', () => {
        let usagePriceListLookupMock;
        const fakePriceListArray = [{}, {}];
        let costEntity: EBSCostEntity;
        beforeEach(() => {
            usagePriceListLookupMock = jest
                .spyOn(EBSCostEntity, 'getPriceDimensionFromPriceList')
                .mockImplementation(() => ({ unit: 'fakeUnit', pricePerUnit: { USD: '7.2' } }));
            costEntity = new EBSCostEntity({
                businessID: '46c36936-ec9c-4a03-a43e-881b74902ef5',
                timeDelta: 1,
                volumeID: 'd780ff47-648c-431d-843c-e094a54b5655',
                size: 4000000,
                tags: [],
                throughput: 4000,
                availabilityZone: '3',
                region: 'us-east-1',
                iops: 10,
                iopsUnitCosts: [],
                storageUnitCost: 0.0005,
                state: 'in-use',
                freeIops: 0,
                volumeType: 'io2',
                serviceId: '0439fcde-67dd-4aac-b68c-adccefd25b35',
            });
        });
        it('Should take in a cost entity and return a calculated cost entity', () => {
            const ebsCalculatedCost = EBSCostEntity.calculateCost(costEntity);
            expect(ebsCalculatedCost instanceof CalculatedEbsCostEntity).toBe(true);
            expect(ebsCalculatedCost.totalIopsCost).toEqual(0);
            expect(ebsCalculatedCost.totalStorageCost).toEqual(2000);
            expect(ebsCalculatedCost.totalCost).toEqual(2000);
        });
        it('calculate cost should handle ranges of IOPS values correctly', () => {
            const tierTypes = [undefined, 'tier2', 'tier3'];
            const iopsUnitCosts = [];
            tierTypes.forEach((tierType) => {
                const iopsCostRange = EBSCostEntity.getClassForUsageName(
                    'VolumeP-IOPS',
                    supportedEBSTypes.io2,
                    fakePriceListArray,
                    tierType,
                );
                costEntity.iopsUnitCosts.push(iopsCostRange);
                iopsUnitCosts.push(iopsCostRange);
            });
            costEntity.iops = 70000;
            const ebsCalculatedCost = EBSCostEntity.calculateCost(costEntity);
            iopsUnitCosts.sort((a, b) => a.startRange - b.startRange);
            const IopsAfterFreeTier = costEntity.iops - costEntity.freeIops;
            const totalIopsCost =
                (iopsUnitCosts[0].endRange - iopsUnitCosts[0].startRange) * iopsUnitCosts[0].cost +
                (iopsUnitCosts[1].endRange - iopsUnitCosts[1].startRange) * iopsUnitCosts[1].cost +
                (IopsAfterFreeTier - iopsUnitCosts[2].startRange) * iopsUnitCosts[2].cost;
            const totalStorageCost = costEntity.size * costEntity.storageUnitCost * costEntity.timeDelta;
            const totalCost = totalIopsCost + totalStorageCost;
            expect(ebsCalculatedCost instanceof CalculatedEbsCostEntity).toBe(true);
            expect(ebsCalculatedCost.totalIopsCost).toEqual(totalIopsCost);
            expect(ebsCalculatedCost.totalStorageCost).toEqual(totalStorageCost);
            expect(ebsCalculatedCost.totalCost).toEqual(totalCost);
        });

        it('calculate cost provide an accurate total for a simple calculation', () => {
            const gp3IopsCostRange = EBSCostEntity.getClassForUsageName(
                'VolumeP-IOPS',
                supportedEBSTypes.gp3,
                fakePriceListArray,
            );
            costEntity.iopsUnitCosts.push(gp3IopsCostRange);
            costEntity.iops = 70000;
            costEntity.freeIops = 3000;
            const ebsCalculatedCost = EBSCostEntity.calculateCost(costEntity);
            const IopsAfterFreeTier = costEntity.iops - costEntity.freeIops;
            const totalIopsCost = (IopsAfterFreeTier - gp3IopsCostRange.startRange) * gp3IopsCostRange.cost;
            const totalStorageCost = costEntity.size * costEntity.storageUnitCost * costEntity.timeDelta;
            const totalCost = totalIopsCost + totalStorageCost;
            expect(ebsCalculatedCost instanceof CalculatedEbsCostEntity).toBe(true);
            expect(ebsCalculatedCost.totalIopsCost).toEqual(totalIopsCost);
            expect(ebsCalculatedCost.totalStorageCost).toEqual(totalStorageCost);
            expect(ebsCalculatedCost.totalCost).toEqual(totalCost);
        });

        it('should take into account freeIops for specific volume types', () => {
            const otherIopsCostRange = EBSCostEntity.getClassForUsageName(
                'VolumeP-IOPS',
                supportedEBSTypes.gp2,
                fakePriceListArray,
            );
            costEntity.iopsUnitCosts.push(otherIopsCostRange);
            costEntity.iops = 70000;
            costEntity.freeIops = 0;
            const ebsCalculatedCost = EBSCostEntity.calculateCost(costEntity);
            const IopsAfterFreeTier = costEntity.iops - costEntity.freeIops;
            const totalIopsCost = (IopsAfterFreeTier - otherIopsCostRange.startRange) * otherIopsCostRange.cost;
            const totalStorageCost = costEntity.size * costEntity.storageUnitCost * costEntity.timeDelta;
            const totalCost = totalIopsCost + totalStorageCost;
            expect(ebsCalculatedCost instanceof CalculatedEbsCostEntity).toBe(true);
            expect(ebsCalculatedCost.totalIopsCost).toEqual(totalIopsCost);
            expect(ebsCalculatedCost.totalStorageCost).toEqual(totalStorageCost);
            expect(ebsCalculatedCost.totalCost).toEqual(totalCost);
        });
    });

    /**
     * #47epyq5 - Unit tests for usage name lookup function on cost entity
     */
    describe('Get Class for usage name', () => {
        let usagePriceListLookupMock;
        const fakePriceListArray = [{}, {}];
        beforeEach(() => {
            usagePriceListLookupMock = jest
                .spyOn(EBSCostEntity, 'getPriceDimensionFromPriceList')
                .mockImplementation(() => ({ unit: 'fakeUnit', pricePerUnit: { USD: '1' } }));
        });
        it('Given VolumeP-Throughput for usage, should return a ThroughPutUnitCostRanges class ', () => {
            const usageClass = EBSCostEntity.getClassForUsageName(
                'VolumeP-Throughput',
                supportedEBSTypes.gp3,
                fakePriceListArray,
            );
            expect(usageClass instanceof ThroughPutUnitCostRanges).toBe(true);
        });
        it('Should support all supported EBS types', () => {
            const ebsVolumeTypes = Object.keys(supportedEBSTypes);
            ebsVolumeTypes.forEach((ebsVolumeType) => {
                const storageCostRange = EBSCostEntity.getClassForUsageName(
                    'VolumeUsage',
                    supportedEBSTypes[ebsVolumeType],
                    fakePriceListArray,
                );
                expect(storageCostRange instanceof StorageUnitCostRanges).toBe(true);
                const iopsCostRange = EBSCostEntity.getClassForUsageName(
                    'VolumeP-IOPS',
                    supportedEBSTypes[ebsVolumeType],
                    fakePriceListArray,
                );
                expect(iopsCostRange instanceof IOPSUnitCostRanges).toBe(true);
                const throughputUnitCostRange = EBSCostEntity.getClassForUsageName(
                    'VolumeP-Throughput',
                    supportedEBSTypes[ebsVolumeType],
                    fakePriceListArray,
                );
                expect(throughputUnitCostRange instanceof ThroughPutUnitCostRanges).toBe(true);
            });
        });
        it('Given VolumeP-IOPS for usage, should return a IOPSUnitCostRanges class ', () => {
            const iopsUnitCostRanges = EBSCostEntity.getClassForUsageName(
                'VolumeP-IOPS',
                supportedEBSTypes.gp3,
                fakePriceListArray,
            );
            expect(iopsUnitCostRanges instanceof IOPSUnitCostRanges).toBe(true);
        });
        it('Given VolumeP-IOPS for usage, Correctly assign tiers', () => {
            const tierTypes = [undefined, 'tier2', 'tier3'];
            tierTypes.forEach((tierType) => {
                const iopsUnitCostRanges = EBSCostEntity.getClassForUsageName(
                    'VolumeP-IOPS',
                    supportedEBSTypes.io2,
                    fakePriceListArray,
                    tierType,
                );
                expect(iopsUnitCostRanges instanceof IOPSUnitCostRanges).toBe(true);
            });
        });
        it('Given VolumeUsage for usage, should return a StorageUnitCostRanges class ', () => {
            const storageCostRange = EBSCostEntity.getClassForUsageName(
                'VolumeUsage',
                supportedEBSTypes.gp3,
                fakePriceListArray,
            );
            expect(storageCostRange instanceof StorageUnitCostRanges).toBe(true);
        });
        it('Should throw an error if an invalid usage name is passed in', () => {
            try {
                EBSCostEntity.getClassForUsageName('Invalid Usage Name', supportedEBSTypes.gp3, fakePriceListArray);
            } catch (error) {
                expect(error).toBeInstanceOf(InternalServerErrorException);
            }
        });
    });
});
