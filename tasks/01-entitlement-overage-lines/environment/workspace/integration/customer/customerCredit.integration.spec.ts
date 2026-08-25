import { setupCustomerWallStrTrading } from '../setupAndTeardown/setup.js';

describe('Customer Credit', () => {
    test('Should set credit value correctly, happy path', async () => {
        const customer = await setupCustomerWallStrTrading();
        await customer.setTransactionCredit('100');
        const newCustomer = await customer.get();
        expect(newCustomer.creditBalance).toEqual('100');
    });
});
