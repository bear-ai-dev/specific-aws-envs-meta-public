import { DlqType, StandardMeasurementEntity } from './standardMeasurement.entity.js';

describe('StandardMeasurementEntity DLQ keys', () => {
    it('keeps the source file name as the prefix of the dlq key', () => {
        const key = StandardMeasurementEntity.buildDLQKey('business-1/2024/01/01/usage.json');
        expect(key.startsWith('business-1/2024/01/01/usage.json-')).toBe(true);
        expect(key.endsWith('.json')).toBe(true);
    });

    it('generates a unique key per failure so earlier rejections are never overwritten', () => {
        const keys = new Set(
            Array.from({ length: 100 }, () => StandardMeasurementEntity.buildDLQKey('business-1/usage.json')),
        );
        expect(keys.size).toBe(100);
    });

    it('supports the s3 dlq type', () => {
        expect(DlqType.s3).toBe('s3');
    });
});
