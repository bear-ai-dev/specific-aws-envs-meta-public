import { ObjectAlreadyExistsError } from '../../utils/aws/s3.js';
import { DlqType, StandardMeasurementEntity } from './standardMeasurement.entity.js';

jest.mock('../../utils/aws/s3.js', () => {
    class ObjectAlreadyExistsError extends Error {
        constructor(Bucket: string, Key: string) {
            super(`Object s3://${Bucket}/${Key} already exists, refusing to overwrite it`);
            this.name = 'ObjectAlreadyExistsError';
        }
    }
    return {
        ObjectAlreadyExistsError,
        putDocumentWithoutOverwrite: jest.fn(),
        documentExists: jest.fn(),
    };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { putDocumentWithoutOverwrite } = require('../../utils/aws/s3.js');

describe('StandardMeasurementEntity datastore dlq', () => {
    const failedDocument = { originalFileContent: '{"broken":', s3Key: 'business-1/2024/01/01/usage.json' };
    const metadata = {
        timestamp: '2024-01-01T00:00:00.000Z',
        errorInfo: { name: 'SyntaxError', message: 'bad json' },
        results: 'failed to load data',
        orginalProcessedName: 'business-1/2024/01/01/usage.json',
    };
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME = 'dlq-bucket';
    });

    test('writes the failed message under its source file', async () => {
        const key = await StandardMeasurementEntity.publishFailureToDLQ(failedDocument, metadata as any, DlqType.s3);
        expect(key).toMatch(/^business-1\/2024\/01\/01\/usage\.json-[a-z0-9]{6}\.json$/);
        expect(putDocumentWithoutOverwrite).toHaveBeenCalledWith(
            JSON.stringify({ failedDocument, metadata }),
            'dlq-bucket',
            key,
        );
    });

    test('retains messages which have no source file', async () => {
        const orginalProcessedName = StandardMeasurementEntity.buildFailedMessageName(undefined);
        expect(orginalProcessedName).toMatch(/^meteringco-unknown\//);
        const key = await StandardMeasurementEntity.publishFailureToDLQ(
            { originalFileContent: 'content' },
            { ...metadata, orginalProcessedName } as any,
            DlqType.s3,
        );
        expect(key).toMatch(new RegExp(`^${orginalProcessedName}-[a-z0-9]{6}\\.json$`));
    });

    test('never overwrites an earlier rejection of the same source', async () => {
        putDocumentWithoutOverwrite.mockRejectedValueOnce(
            new ObjectAlreadyExistsError('dlq-bucket', `${metadata.orginalProcessedName}-aaaaaa.json`),
        );
        const key = await StandardMeasurementEntity.publishFailureToDLQ(failedDocument, metadata as any, DlqType.s3);
        expect(putDocumentWithoutOverwrite).toHaveBeenCalledTimes(2);
        expect(key).toMatch(/^business-1\/2024\/01\/01\/usage\.json-[a-z0-9]{6}\.json$/);
    });

    test('swallows storage failures so the caller can still be rejected', async () => {
        putDocumentWithoutOverwrite.mockRejectedValue(new Error('bucket exploded'));
        await expect(
            StandardMeasurementEntity.publishFailureToDLQ(failedDocument, metadata as any, DlqType.s3),
        ).resolves.toBeUndefined();
    });
});
