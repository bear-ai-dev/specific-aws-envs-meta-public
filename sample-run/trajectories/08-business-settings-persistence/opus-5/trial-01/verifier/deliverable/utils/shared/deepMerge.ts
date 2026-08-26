/**
 * Utilities to support partial (PATCH style) updates of documents.
 *
 * A caller only ever sends the fields they touched. Anything they did not send must keep whatever
 * was already stored, while anything they did send must be written, even when the value they sent is
 * empty (an empty string, `null`, `false`, or `0`), since clearing a value is a deliberate action and
 * is not the same as never having sent the field at all.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlainRecord = Record<string, any>;

/**
 * Determines if a value should be merged key by key, rather than replaced wholesale.
 * Arrays, dates, and other non plain objects are replaced wholesale.
 */
export const isMergeableObject = (value: unknown): boolean => {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    if (Array.isArray(value) || value instanceof Date) {
        return false;
    }
    return true;
};

/**
 * Recursively merges the `update` document over the `base` document.
 * <br><br>
 * - keys absent from `update` (or explicitly `undefined`) keep the value held by `base`
 * - keys present on `update` are written, even when the value is empty (`''`, `null`, `false`, `0`)
 * - nested objects are merged key by key, so naming one nested member leaves its siblings alone
 * - arrays are replaced wholesale
 */
export const deepMergeDefined = <T extends PlainRecord>(base: T, update: PlainRecord): T => {
    const merged: PlainRecord = { ...(base ?? {}) };

    if (!update) {
        return merged as T;
    }

    for (const key of Object.keys(update)) {
        const updatedValue = update[key];
        // The caller never named this field, keep what is stored
        if (updatedValue === undefined) {
            continue;
        }
        const baseValue = merged[key];
        if (isMergeableObject(updatedValue) && isMergeableObject(baseValue)) {
            merged[key] = deepMergeDefined(baseValue as PlainRecord, updatedValue as PlainRecord);
        } else if (isMergeableObject(updatedValue)) {
            merged[key] = deepMergeDefined({}, updatedValue as PlainRecord);
        } else {
            merged[key] = updatedValue;
        }
    }

    return merged as T;
};
