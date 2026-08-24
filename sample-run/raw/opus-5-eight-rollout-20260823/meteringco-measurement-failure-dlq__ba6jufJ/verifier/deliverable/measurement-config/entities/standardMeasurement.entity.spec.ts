import { putDocument } from '../../utils/aws/s3.js';
import { DlqType, StandardMeasurementEntity } from './standardMeasurement.entity.js';

jest.mock('../../utils/aws/s3.js', () => ({
    putDocument: jest.fn(),
}));

const mockedPutDocument = putDocument as unknown as jest.Mock;

describe('StandardMeasurementEntity datastore DLQ', () => {
    const done = jest.fn();
    const dlqBucket = 'test-dlq-bucket';
    let originalBucket: string;

    beforeEach(() => {
        originalBucket = process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
        process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME = dlqBucket;
        mockedPutDocument.mockReset();
        done.mockReset();
        mockedPutDocument.mockReturnValue({ done });
    });

    afterEach(() => {
        process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME = originalBucket;
    });

    const metadataFor = (orginalProcessedName?: string) => ({
        timestamp: '2023-01-01T00:00:00.000Z',
        errorInfo: { name: 'SyntaxError', message: 'bad json' },
        results: 'failed to load data',
        orginalProcessedName,
    });

    it('writes the failure under the source file in the configured dlq bucket', async () => {
        const s3Key = 'businessOne/2023/01/01/usage.json';
        const failedDocument = { originalFileContent: '{"broken', s3Key };
        await StandardMeasurementEntity.publishFailureToDLQ(failedDocument, metadataFor(s3Key) as any, DlqType.s3);
        expect(mockedPutDocument).toHaveBeenCalledTimes(1);
        const [body, bucket, key] = mockedPutDocument.mock.calls[0];
        expect(bucket).toBe(dlqBucket);
        expect(key).toMatch(new RegExp(`^${s3Key}-[a-z0-9]{6}\\.json$`));
        expect(JSON.parse(body)).toEqual({ failedDocument, metadata: metadataFor(s3Key) });
        expect(done).toHaveBeenCalled();
    });

    it('generates a unique key per failure so earlier failures are never overwritten', async () => {
        const s3Key = 'businessOne/2023/01/01/usage.json';
        await StandardMeasurementEntity.publishFailureToDLQ({}, metadataFor(s3Key) as any, DlqType.s3);
        await StandardMeasurementEntity.publishFailureToDLQ({}, metadataFor(s3Key) as any, DlqType.s3);
        const [firstKey, secondKey] = mockedPutDocument.mock.calls.map(([, , key]) => key);
        expect(firstKey).not.toBe(secondKey);
    });

    it('retains failures which have no source file under the unknown prefix', async () => {
        await StandardMeasurementEntity.publishFailureToDLQ(
            { originalFileContent: '{"a":1}' },
            metadataFor(undefined) as any,
            DlqType.s3,
        );
        const [body, , key] = mockedPutDocument.mock.calls[0];
        expect(key).toMatch(/^meteringco-unknown\/[a-z0-9-]+-[a-z0-9]{6}\.json$/);
        const { metadata } = JSON.parse(body);
        expect(key.startsWith(metadata.orginalProcessedName)).toBe(true);
    });

    it('does not throw when the dlq write is refused', async () => {
        done.mockRejectedValue(new Error('AccessDenied'));
        await expect(
            StandardMeasurementEntity.publishFailureToDLQ({}, metadataFor('a/b.json') as any, DlqType.s3),
        ).resolves.toBeUndefined();
    });

    it('does not write to s3 when no dlq bucket is configured', async () => {
        delete process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME;
        await expect(
            StandardMeasurementEntity.publishFailureToDLQ({}, metadataFor('a/b.json') as any, DlqType.s3),
        ).resolves.toBeUndefined();
        expect(mockedPutDocument).not.toHaveBeenCalled();
    });
});
