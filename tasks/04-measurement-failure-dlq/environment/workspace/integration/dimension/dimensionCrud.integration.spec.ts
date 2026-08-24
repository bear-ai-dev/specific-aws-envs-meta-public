import {
    AggregationInterval,
    AggregationMethod,
    Dimension,
    OverageAllowed,
    Rounding,
} from '../client/publicClient/dimension.js';
import { sleep } from '../utils/utils.js';

describe('dimension CRUD', () => {
    test('Get all dimensions should return an array', async () => {
        const dimensionClient = new Dimension();
        const response = await dimensionClient.getAll();
        expect(response).toEqual(expect.any(Array));
    });

    test('CREATE and DELETE should function correctly', async () => {
        const dimension = new Dimension();
        const dimensionId = await dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            name: 'Request',
            consumptionPrice: '0.4',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        expect(dimensionId).toEqual(expect.any(String));
        await sleep(2000);
        await dimension.delete();
        await sleep(2000);
        const res = (await Dimension.getByDimensionId(dimensionId)) as Response;
        expect(res.status).toEqual(404);
    });
    test('Dimensions Created with more than 8 digits of precesion should fail', async () => {
        const dimension = new Dimension();
        expect(
            dimension.create({
                aggregationInterval: AggregationInterval.Hour,
                aggregationMethod: AggregationMethod.Sum,
                name: 'Request',
                consumptionPrice: '0.000000004',
                rounding: Rounding.Ceiling,
                usageIncrement: '1',
                consumptionUnit: {
                    unit: 'count-based',
                    type: 'count',
                },
            })
        ).rejects.toThrow();
    });
    test('CREATE Entitlement dimensions should not set consumption price if overage is false', async () => {
        const dimension = new Dimension();
        const dimensionId = await dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            name: 'Request',
            overageAllowed: OverageAllowed.False,
            usageEntitlement: 1,
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        expect(dimensionId).toEqual(expect.any(String));
        await sleep(2000);
        await dimension.delete();
        await sleep(2000);
        const res = (await Dimension.getByDimensionId(dimensionId)) as Response;
        expect(res.status).toEqual(404);
    });
    test('CREATE Entitlement dimensions should set a consumption price if overage is true', async () => {
        const dimension = new Dimension();
        const dimensionId = await dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            name: 'Request',
            overageAllowed: OverageAllowed.True,
            consumptionPrice: '2',
            usageEntitlement: 1,
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        expect(dimensionId).toEqual(expect.any(String));
        await sleep(2000);
        await dimension.delete();
        await sleep(2000);
        const res = (await Dimension.getByDimensionId(dimensionId)) as Response;
        expect(res.status).toEqual(404);
    });

    test('CREATE Entitlement dimensions Should fail if consumption price is set and overage is false', async () => {
        const dimension = new Dimension();
        const response = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            name: 'Request',
            consumptionPrice: '0.4',
            overageAllowed: OverageAllowed.False,
            usageEntitlement: 1,
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response).rejects.toThrow();
    });
    test('CREATE dimensions Should fail if consumption price is not set and there are no entitlements', async () => {
        const dimension = new Dimension();
        const response = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            name: 'Request',
            rounding: Rounding.Ceiling,
            usageIncrement: 1,
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response).rejects.toThrow();
    });
    test('CREATE dimensions Should fail if consumption price is not set and there are entitlements with overage', async () => {
        const dimension = new Dimension();
        const response = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            name: 'Request',
            rounding: Rounding.Ceiling,
            overageAllowed: OverageAllowed.True,
            usageEntitlement: 1,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response).rejects.toThrow();
    });
    test('CREATE dimensions Should fail if overage allowed is set and there are entitlements but no consumption price', async () => {
        const dimension = new Dimension();
        const response = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            overageAllowed: OverageAllowed.True,
            usageEntitlement: 20,
            name: 'Request',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response).rejects.toThrow();
    });
    test('CREATE dimensions Should fail if entitlements are not a numeric int', async () => {
        const dimension = new Dimension();
        const response = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            overageAllowed: OverageAllowed.True,
            usageEntitlement: '20',
            consumptionPrice: '0.4',
            name: 'Request',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response).rejects.toThrow();
        const response2 = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            overageAllowed: OverageAllowed.True,
            usageEntitlement: 'abc',
            consumptionPrice: '0.4',
            name: 'Request',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response2).rejects.toThrow();
    });
    test('CREATE dimensions Should fail if overage allowed is set and entitlements are inf', async () => {
        const dimension = new Dimension();
        const response = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            overageAllowed: OverageAllowed.True,
            usageEntitlement: 'inf',
            consumptionPrice: '0.4',
            name: 'Request',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response).rejects.toThrow();
    });

    test('CREATE dimensions Should fail if consumption price is not a numeric string', async () => {
        const dimension = new Dimension();
        const response = dimension.create({
            aggregationInterval: AggregationInterval.Hour,
            aggregationMethod: AggregationMethod.Sum,
            consumptionPrice: 'abc',
            name: 'Request',
            rounding: Rounding.Ceiling,
            usageIncrement: '1',
            consumptionUnit: {
                unit: 'count-based',
                type: 'count',
            },
        });
        await expect(response).rejects.toThrow();
    });
});
