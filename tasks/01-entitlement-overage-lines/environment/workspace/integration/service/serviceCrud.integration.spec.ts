import { Service } from '../client/publicClient/service.js';

describe('Service CRUD', () => {
    test('Services endpoint should 404', async () => {
        const serviceClient = new Service();
        await expect(serviceClient.getAll()).rejects.toThrow();
    });
});
