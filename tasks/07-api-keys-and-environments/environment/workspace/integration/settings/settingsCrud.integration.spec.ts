import { Scheduler } from '../client/privateClient/scheduler.js';
import { ACCESS_TOKEN } from '../client/publicClient/init.js';
import { ComputeCostSource, Setting, TaxCalculationType } from '../client/privateClient/settings.js';
import { User } from '../client/privateClient/user.js';
import { sampleBasicSettings } from '../setupAndTeardown/setup.js';
import { sleep } from '../utils/utils.js';

describe('Settings CRUD', () => {
    test('Set basic settings', async () => {
        const data = await Setting.update(sampleBasicSettings);
        expect(data).toEqual({
            ...new Setting(sampleBasicSettings),
            stripeConnected: expect.anything(),
            taxJarApiKey: expect.anything(),
            accountState: expect.anything(),
        });
    });

    test('cloud IAM should be checked and fail if given a role MeteringCo cannot assume', async () => {
        const res = await Setting.update({ cloudIAM: { iamRoleArn: 'wow a fake role', externalId: 'foobar' } });
        expect(res.statusCode).toEqual(400);
        expect(res.message[0]).toEqual(expect.stringContaining('IAM'));
    });

    test('TaxJar API key should be checked and fail if the key is invalid', async () => {
        const res = await Setting.update({ taxJarApiKey: 'wow a fake key!' });
        expect(res.statusCode).toEqual(400);
        expect(res.message[0]).toEqual(expect.stringContaining('TaxJar'));
    });
    test('Changing settings to meteringco calculated should fail if taxJarAPIkey is not set', async () => {
        const res = await Setting.update({ taxCalculationType: TaxCalculationType.meteringcoCalculated });
        expect(res.statusCode).toEqual(400);
        expect(res.message[0]).toEqual(expect.stringContaining('TaxJar'));
    });

    xtest('Should allow tax calculation type to be meteringco calculated if a taxjar API key is sent in on the request', async () => {
        const res = await Setting.update({
            ...sampleBasicSettings,
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
            taxJarApiKey: '<INSERT_SANDBOX_KEY>',
        });
        expect(res).toEqual({
            ...new Setting(sampleBasicSettings),
            stripeConnected: expect.anything(),
            taxJarApiKey: '<INSERT_SANDBOX_KEY>',
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
        });
    });

    xtest('Should accept production taxjar key if account is a production account', async () => {
        const res = await Setting.update({
            ...sampleBasicSettings,
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
            accountState: 'production',
            taxJarApiKey: '<INSERT_PROD_KEY>',
        });
        expect(res).toEqual({
            ...new Setting(sampleBasicSettings),
            stripeConnected: expect.anything(),
            taxJarApiKey: '<INSERT_PROD_KEY>',
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
            accountState: 'production',
        });
    });

    xtest('Should allow tax calculation type to be meteringco calculated if a taxjar API key is already set', async () => {
        await Setting.update({
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
            taxJarApiKey: '<INSERT_SANDBOX_KEY>',
        });
        await sleep(1000);
        await Setting.update({
            taxCalculationType: TaxCalculationType.manual,
        });
        await sleep(1000);
        const res = await Setting.update({
            ...sampleBasicSettings,
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
        });
        expect(res).toEqual({
            ...new Setting(sampleBasicSettings),
            stripeConnected: expect.anything(),
            taxJarApiKey: '<INSERT_SANDBOX_KEY>',
            taxCalculationType: TaxCalculationType.meteringcoCalculated,
        });
    });
    describe('Settings Scheduler', () => {
        test('Setting EKS setting should schedule cost events for the user', async () => {
            const data = await Setting.update({ ...sampleBasicSettings, computeCostSource: ComputeCostSource.eks });
            expect(data).toEqual({
                ...new Setting(sampleBasicSettings),
                stripeConnected: expect.anything(),
                taxJarApiKey: expect.anything(),
                accountState: expect.anything(),
            });
            const {
                data: [{ businessID }],
            } = await User.get(ACCESS_TOKEN);
            await sleep(1000 * 1.5);
            const [{ id: schedulerId }] = await Scheduler.get(`${businessID}-getAndCommitPODCost`);
            expect(schedulerId).toEqual(expect.anything());
        });

        test('Setting EKS setting should unset schedule when removed', async () => {
            const data = await Setting.update({ ...sampleBasicSettings, computeCostSource: ComputeCostSource.eks });
            expect(data).toEqual({
                ...new Setting(sampleBasicSettings),
                stripeConnected: expect.anything(),
                taxJarApiKey: expect.anything(),
                accountState: expect.anything(),
            });
            const {
                data: [{ businessID }],
            } = await User.get(ACCESS_TOKEN);
            await sleep(1000 * 1.5);
            const [{ id: schedulerId }] = await Scheduler.get(`${businessID}-getAndCommitPODCost`);
            expect(schedulerId).toEqual(expect.anything());
            const data2 = await Setting.update({ ...sampleBasicSettings, computeCostSource: ComputeCostSource.none });
            expect(data2).toEqual({
                ...new Setting({ ...sampleBasicSettings, computeCostSource: ComputeCostSource.none }),
                stripeConnected: expect.anything(),
                taxJarApiKey: expect.anything(),
            });
            await sleep(1000 * 1.5);
            await expect(Scheduler.get(`${businessID}-getAndCommitPODCost`)).rejects.toEqual(
                expect.objectContaining({ statusCode: 404 })
            );
        });
    });
});
