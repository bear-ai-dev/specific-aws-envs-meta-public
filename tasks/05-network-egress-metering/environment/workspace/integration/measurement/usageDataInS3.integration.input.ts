export const ONE_OBJECT_INPUT = [
    { recordValues: ['1'], expected: ['1'] },
    { recordValues: ['1', '2'], expected: ['1', '2'] },
    { recordValues: ['1', '2', '3'], expected: ['1', '2', '3'] },
    { recordValues: ['0.1', '0.2', '0.3'], expected: ['0.1', '0.2', '0.3'] },
    { recordValues: ['-1', '-2', '-3'], expected: ['-1', '-2', '-3'] },
    { recordValues: ['1000000000', '2000000000', '3000000000'], expected: ['1000000000', '2000000000', '3000000000'] },
    {
        recordValues: ['-1000000000', '-2000000000', '-3000000000'],
        expected: ['-1000000000', '-2000000000', '-3000000000'],
    },
    // { recordValues: ["1", null], expected: ["1"] },
    // { recordValues: [null, "1"], expected: ["1"] },
    // { recordValues: [null, null], expected: [] },
    // { recordValues: [null], expected: [] },
    // { recordValues: ["1", "2", null], expected: ["1", "2"] },
    // { recordValues: ["1", null, "2"], expected: ["1", "2"] },
    // { recordValues: [null, "1", "2"], expected: ["1", "2"] },
    // { recordValues: [null, null, "1"], expected: ["1"] },
    // { recordValues: [null, "1", null], expected: ["1"] },
    // { recordValues: ["1", null, null], expected: ["1"] },
    // { recordValues: [1], expected: [] },
    // { recordValues: ['a'], expected: [] },
    // { recordValues: ["a"], expected: [] },
    // { recordValues: [{"foo": "bar"}], expected: ["1"] },
    // { recordValues: [null, "1", null, null, null, null, null, null, null, null, null, null, null, null], expected: ["1"] }
];

export const DLQ_INPUT = [
    { content: '1', items: 1 },
    { content: 1, items: 1 },
    { content: 'a', items: 1 },
    { content: JSON.stringify({ foo: 'bar' }, null, 2), items: 3 },
    { content: '1\n2\n3', items: 3 },
];
