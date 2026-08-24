import { BadRequestException } from '@nestjs/common';
import { createMock } from '@golevelup/ts-jest';
import { PrivateAPIUsageController } from './usage.controller.js';
import { UsageService } from './usage.service.js';
import { InvoicesService } from '../invoice/invoices.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { putDocumentWithoutOverwrite } from '../utils/aws/s3.js';

jest.mock('../utils/aws/s3.js', () => ({
    putDocumentWithoutOverwrite: jest.fn().mockResolvedValue(true),
    doesObjectExist: jest.fn().mockResolvedValue(false),
    getS3Client: jest.fn(),
    putDocument: jest.fn(),
}));

const putMock = putDocumentWithoutOverwrite as jest.Mock;

describe('PrivateAPIUsageController datastore dlq', () => {
    let controller: PrivateAPIUsageController;
    const dlqBucket = 'meteringco-usage-record-dlq-bucket-test';

    beforeEach(() => {
        process.env.DB_MEASUREMENT_DLQ_BUCKET_NAME = dlqBucket;
        putMock.mockClear();
        putMock.mockResolvedValue(true);
        controller = new PrivateAPIUsageController(
            createMock<UsageService>(),
            createMock<InvoicesService>(),
            createMock<CustomerService>(),
        );
    });

    it('stores an unparsable message in the dlq bucket under its source file', async () => {
        const s3Key = 'my-business/2023/01/01/usage-1.json';
        const message = '{"customerId": "cool-customer"';

        await expect(controller.dbUsage({ message, s3Key })).rejects.toBeInstanceOf(BadRequestException);

        expect(putMock).toHaveBeenCalledTimes(1);
        const [document, Bucket, Key] = putMock.mock.calls[0];
        expect(Bucket).toBe(dlqBucket);
        expect(Key.startsWith(`${s3Key}-`)).toBe(true);
        expect(Key.endsWith('.json')).toBe(true);
        const { failedDocument, metadata } = JSON.parse(document);
        expect(failedDocument).toEqual({ originalFileContent: message, s3Key });
        expect(metadata.orginalProcessedName).toBe(s3Key);
        expect(metadata.results).toBe('failed to load data');
        expect(metadata.errorInfo).toEqual({ name: 'SyntaxError', message: expect.any(String) });
        expect(metadata.timestamp).toEqual(expect.any(String));
    });

    it('stores validation failures with the failing constraints', async () => {
        const s3Key = 'my-business/2023/01/01/usage-2.json';
        const message = JSON.stringify({
            timestamp: '01/01/2023 08:00',
            customerId: 'cool-customer',
            dimensionId: 'cool-dimension',
            recordValue: '10',
        });

        await expect(controller.dbUsage({ message, s3Key })).rejects.toBeInstanceOf(BadRequestException);

        const [document] = putMock.mock.calls[0];
        const { metadata } = JSON.parse(document);
        expect(metadata.errorInfo[0].property).toBe('timestamp');
        expect(metadata.errorInfo[0].constraints).toEqual({ isRFC3339: 'timestamp must be RFC 3339 date' });
    });

    it('never overwrites an earlier rejection of the same source file', async () => {
        const s3Key = 'my-business/2023/01/01/usage-3.json';
        const message = 'not-json';

        await expect(controller.dbUsage({ message, s3Key })).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.dbUsage({ message, s3Key })).rejects.toBeInstanceOf(BadRequestException);

        const [firstKey, secondKey] = putMock.mock.calls.map(([, , Key]) => Key);
        expect(firstKey).not.toBe(secondKey);
    });

    it('retains messages which have no source file', async () => {
        const message = JSON.stringify({ customerId: 'cool-customer' });

        await expect(controller.dbUsage({ message })).rejects.toBeInstanceOf(BadRequestException);

        const [document, Bucket, Key] = putMock.mock.calls[0];
        expect(Bucket).toBe(dlqBucket);
        expect(Key.startsWith('meteringco-unknown/')).toBe(true);
        const { failedDocument, metadata } = JSON.parse(document);
        expect(failedDocument).toEqual({ originalFileContent: message });
        expect(Key.startsWith(`${metadata.orginalProcessedName}-`)).toBe(true);
    });

    it('rejects the caller even when the dlq write fails', async () => {
        putMock.mockRejectedValue(new Error('Access Denied'));

        await expect(
            controller.dbUsage({ message: 'not-json', s3Key: 'my-business/2023/01/01/usage-4.json' }),
        ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('loads valid messages instead of writing them to the dlq', async () => {
        const usageService = createMock<UsageService>();
        const validController = new PrivateAPIUsageController(
            usageService,
            createMock<InvoicesService>(),
            createMock<CustomerService>(),
        );
        const message = JSON.stringify({
            timestamp: '2023-01-01T08:00:00Z',
            customerId: 'cool-customer',
            dimensionId: 'cool-dimension',
            recordValue: '10',
        });

        await validController.dbUsage({ message, s3Key: 'my-business/2023/01/01/usage-5.json' });

        expect(usageService.create).toHaveBeenCalledWith(expect.objectContaining({ businessID: 'my-business' }));
        expect(putMock).not.toHaveBeenCalled();
    });
});
