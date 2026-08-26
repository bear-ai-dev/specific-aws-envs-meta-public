import { deepMergeDefined, isMergeableObject } from './deepMerge.js';

describe('deepMergeDefined', () => {
    it('keeps values that the update does not name', () => {
        expect(deepMergeDefined({ a: 1, b: 2 }, { b: 3 })).toEqual({ a: 1, b: 3 });
    });

    it('writes values that the update names, even when they are empty', () => {
        expect(
            deepMergeDefined({ a: 'one', b: 'two', c: 'three', d: 'four' }, { a: '', b: null, c: false, d: 0 }),
        ).toEqual({ a: '', b: null, c: false, d: 0 });
    });

    it('ignores explicitly undefined values', () => {
        expect(deepMergeDefined({ a: 'one' }, { a: undefined })).toEqual({ a: 'one' });
    });

    it('merges nested objects member by member', () => {
        expect(
            deepMergeDefined(
                { pages: { invoice: { text: 'Invoice' }, payment: { text: 'Payment', enabled: true } } },
                { pages: { payment: { text: 'Pay Now' } } },
            ),
        ).toEqual({
            pages: { invoice: { text: 'Invoice' }, payment: { text: 'Pay Now', enabled: true } },
        });
    });

    it('replaces arrays wholesale', () => {
        expect(deepMergeDefined({ offerings: [1, 2, 3] }, { offerings: [4] })).toEqual({ offerings: [4] });
    });

    it('does not mutate the documents it is given', () => {
        const base = { nested: { keep: 'yes' } };
        const update = { nested: { keep: 'no' } };
        deepMergeDefined(base, update);
        expect(base.nested.keep).toEqual('yes');
        expect(update.nested.keep).toEqual('no');
    });

    it('knows what can be merged', () => {
        expect(isMergeableObject({})).toEqual(true);
        expect(isMergeableObject([])).toEqual(false);
        expect(isMergeableObject(new Date())).toEqual(false);
        expect(isMergeableObject(null)).toEqual(false);
        expect(isMergeableObject('string')).toEqual(false);
    });
});
