export const VALID_MEASUREMENT_INPUT = [
    { recordValues: ['1'], expected: ['1'] },
    { recordValues: ['1', '2'], expected: ['1', '2'] },
    { recordValues: ['2', '1'], expected: ['2', '1'] },
    { recordValues: ['1', '2', '3'], expected: ['1', '2', '3'] },
    { recordValues: ['1.1'], expected: ['1.1'] },
    { recordValues: ['0'], expected: ['0'] },
    { recordValues: ['0.0'], expected: ['0'] },
    { recordValues: ['0.1'], expected: ['0.1'] },
    { recordValues: ['-1'], expected: ['-1'] },
    { recordValues: ['1000000000000'], expected: ['1000000000000'] },
    { recordValues: ['-1000000000000'], expected: ['-1000000000000'] },
    { recordValues: ['1', '1', '1', '1', '1', '1'], expected: ['1', '1', '1', '1', '1', '1'] },
];

// For why some values are commented out: https://github.com/example-metering-org/example-billing-service/pull/100/files#discussion_r1000000000
//TLDR JSON does not support NaN, Infinity, -Infinity, undefined, null
export const METADATA_INPUT = [
    { metadata: { a: 1 } },
    { metadata: { a: '1' } },
    { metadata: { a: true } },
    { metadata: { a: null } },
    // {metadata: {a: undefined}},
    // {metadata: {a: NaN}},
    // {metadata: {a: Infinity}},
    // {metadata: {a: -Infinity}},
    { metadata: { a: [] } },
    { metadata: { a: {} } },
    { metadata: { a: 1, b: 2 } },
    // { metadata: null },
    // { metadata: undefined },
];

export const INVALID_METADATA_INPUT = [
    { metadata: 'a' },
    { metadata: 1 },
    { metadata: true },
    // {metadata: NaN},
    // {metadata: Infinity},
];
