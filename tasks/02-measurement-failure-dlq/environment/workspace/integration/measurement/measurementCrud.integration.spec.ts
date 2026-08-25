import {
    DatastoreBasedMeasurementConfig,
    DatastorePlatform,
    UsageRecordInS3Measurement,
} from '../client/publicClient/measurement.js';
import { sleep } from '../utils/utils.js';

describe('Measurement CRUD', () => {
    test('Get all measurements should return an array', async () => {
        const measurementClient = new UsageRecordInS3Measurement();
        const response = await measurementClient.getAll();
        expect(response).toEqual(expect.any(Array));
    });
    test('Delete measurement should work', async () => {
        const measurementClient = new UsageRecordInS3Measurement();
        await measurementClient.create({ name: 'measurement test', accountId: '123456789012' });
        await sleep(2000)
        const getRes = await measurementClient.get();
        expect(getRes.measurementId).toEqual(expect.stringContaining(expect.anything()));
        const measurementId = getRes.measurementId.split('').join('');
        const response = await measurementClient.delete();
        expect(response).toEqual(expect.any(Object));
        const measurementClient2 = new UsageRecordInS3Measurement(measurementId);

        await expect(measurementClient2.get()).rejects.toEqual(expect.objectContaining({ statusCode: 404 }));
    });
});
