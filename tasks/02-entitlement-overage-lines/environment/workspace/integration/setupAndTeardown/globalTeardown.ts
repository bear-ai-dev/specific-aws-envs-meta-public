import { deleteAndResetAllResources } from '../utils/deleteAll.js';

export default async () => {
    const {
        client_id,
        client_secret,
        influx_token,
        test_1_aws_account_id,
        test_1_aws_access_key_id,
        test_1_aws_secret_access_key,
        test_2_aws_account_id,
        test_2_aws_access_key_id,
        test_2_aws_secret_access_key,
    } = require('../secret.json');
    process.env.TEST_1_ACCOUNT_ID = test_1_aws_account_id;
    process.env.TEST_1_AWS_ACCESS_KEY_ID = test_1_aws_access_key_id;
    process.env.TEST_1_AWS_SECRET_ACCESS_KEY = test_1_aws_secret_access_key;
    process.env.TEST_2_ACCOUNT_ID = test_2_aws_account_id;
    process.env.TEST_2_AWS_ACCESS_KEY_ID = test_2_aws_access_key_id;
    process.env.TEST_2_AWS_SECRET_ACCESS_KEY = test_2_aws_secret_access_key;
    const cache = require('../token_cache.json');
    process.env.INFLUX_TOKEN = influx_token;
    process.env.API_ACCESS_TOKEN = cache.access_token;
    await deleteAndResetAllResources();
};
