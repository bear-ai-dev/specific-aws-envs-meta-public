import { Test, TestingModule } from '@nestjs/testing';
import { PrivateAPIUsageController, UsageController } from './usage.controller.js';
import { DlqType, StandardMeasurementEntity } from '../measurement-config/entities/standardMeasurement.entity.js';
import { UsageService } from './usage.service.js';
import { createMock } from '@golevelup/ts-jest';

describe('UsageController', () => {
    let controller: UsageController;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsageController],
            providers: [UsageService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<UsageController>(UsageController);
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });
});

describe('PrivateAPIUsageController datastore usage DLQ', () => {
    let controller: PrivateAPIUsageController;
    let publishFailureToDLQ: jest.SpyInstance;

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [PrivateAPIUsageController],
            providers: [UsageService],
        })
            .useMocker(createMock)
            .compile();

        controller = module.get<PrivateAPIUsageController>(PrivateAPIUsageController);
        publishFailureToDLQ = jest.spyOn(StandardMeasurementEntity, 'publishFailureToDLQ').mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('stores a rejected message in the datastore DLQ under its source file', async () => {
        const s3Key = 'businessID/2023/01/01/usage.json';
        const message = '{"broken';
        await expect(controller.dbUsage({ message, s3Key })).rejects.toThrow(
            'Invalid message format, please check the documentation for the correct format',
        );
        expect(publishFailureToDLQ).toHaveBeenCalledTimes(1);
        const [failedDocument, metadata, dlqType] = publishFailureToDLQ.mock.calls[0];
        expect(failedDocument).toEqual({ originalFileContent: message, s3Key });
        expect(metadata.orginalProcessedName).toBe(s3Key);
        expect(metadata.results).toBe('failed to load data');
        expect(metadata.errorInfo).toEqual({ name: 'SyntaxError', message: expect.any(String) });
        expect(metadata.timestamp).toEqual(expect.any(String));
        expect(dlqType).toBe(DlqType.s3);
    });

    it('keeps a rejected message which has no source file', async () => {
        const message = '{"recordValue":"1"}';
        await expect(controller.dbUsage({ message })).rejects.toThrow(
            'Invalid message format, please check the documentation for the correct format',
        );
        expect(publishFailureToDLQ).toHaveBeenCalledTimes(1);
        const [failedDocument, metadata, dlqType] = publishFailureToDLQ.mock.calls[0];
        expect(failedDocument).toEqual({ originalFileContent: message, s3Key: undefined });
        expect(metadata.orginalProcessedName).toBeUndefined();
        expect(dlqType).toBe(DlqType.s3);
    });

    it('keeps the validation failure information of a rejected message', async () => {
        const s3Key = 'businessID/2023/01/01/usage.json';
        const message = JSON.stringify({
            timestamp: new Date().toISOString(),
            customerId: 'customerId',
            dimensionId: 'dimensionId',
            recordValue: 'not a number',
        });
        await expect(controller.dbUsage({ message, s3Key })).rejects.toThrow(
            'Invalid message format, please check the documentation for the correct format',
        );
        const [, metadata] = publishFailureToDLQ.mock.calls[0];
        expect(Array.isArray(metadata.errorInfo)).toBe(true);
        expect(metadata.errorInfo[0].property).toBe('recordValue');
    });

    it('rejects the caller even when the DLQ write fails', async () => {
        publishFailureToDLQ.mockRejectedValue(new Error('s3 is unavailable'));
        await expect(controller.dbUsage({ message: 'broken', s3Key: 'businessID/usage.json' })).rejects.toThrow(
            'Invalid message format, please check the documentation for the correct format',
        );
        expect(publishFailureToDLQ).toHaveBeenCalledTimes(1);
    });

    it('does not write valid usage to the DLQ', async () => {
        const s3Key = 'businessID/2023/01/01/usage.json';
        const message = JSON.stringify({
            timestamp: new Date().toISOString(),
            customerId: 'customerId',
            dimensionId: 'dimensionId',
            recordValue: '4',
        });
        await controller.dbUsage({ message, s3Key });
        expect(publishFailureToDLQ).not.toHaveBeenCalled();
    });
});
