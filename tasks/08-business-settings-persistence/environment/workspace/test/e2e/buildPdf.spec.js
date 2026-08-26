import { handler } from '../../src/invoice/get/index.js.js';
import exampleInput from '../../examplePOST.js';

// The below import statement grabs the creds for db access for the automated test. It is not stored in Git.
let Creds;
let dburl;
try {
    const {
        default: { CREDS, InfluxDBURL },
    } = await import('../../../secret.json');
    Creds = CREDS;
    dburl = InfluxDBURL;
} catch (error) {
    console.log(error);
    console.log('CREDS NOT FOUND FOR IMPORT IN E2E Testing, this will likely cause the test to fail');
}
describe('Happy Path Build the PDF', () => {
    beforeEach(() => {
        // setCreds
        process.env.INFLUX_TOKEN = Creds;
        process.env.INFLUX_URL = dburl;
    });
    test('Build a pdf', async () => {
        const result = await handler(exampleInput);
        console.log(result);
    });
});
