import { User } from '../client/privateClient/user.js';
import { TEST_ACCESS_TOKEN, TEST_SUBJECT } from '../client/publicClient/init.js';
describe('Users CRUD', () => {
    test('Admin user should be able to update a user', async () => {
        await User.create({ subject: TEST_SUBJECT, businessID: 'testBusiness2' });
        const {
            data: [{ subject, businessID }],
        } = await User.get(TEST_ACCESS_TOKEN);
        expect(subject).toEqual(TEST_SUBJECT);
        expect(businessID).toEqual('testBusiness2');
        await User.create({ subject: TEST_SUBJECT, businessID: 'testBusiness3' });
        const {
            data: [{ subject: subject2, businessID: businessID2 }],
        } = await User.get(TEST_ACCESS_TOKEN);
        expect(subject2).toEqual(TEST_SUBJECT);
        expect(businessID2).toEqual('testBusiness3');
    });
    test("Multiple calls the user endpoint should return the same user data", async () => {
        await User.create({ subject: TEST_SUBJECT, businessID: 'testBusiness4' });
        const {
            data: [{ subject, businessID }],
        } = await User.get(TEST_ACCESS_TOKEN);
        expect(subject).toEqual(TEST_SUBJECT);
        expect(businessID).toEqual('testBusiness4');
        const {
            data: [{ subject: subject2, businessID: businessID2 }],
        } = await User.get(TEST_ACCESS_TOKEN);
        expect(subject2).toEqual(TEST_SUBJECT);
        expect(businessID2).toEqual('testBusiness4');
    });
});
