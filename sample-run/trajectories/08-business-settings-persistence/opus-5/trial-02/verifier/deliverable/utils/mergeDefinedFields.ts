/**
 * Utilities to support "patch" (partial update) semantics for documents.
 *
 * The rules implemented here are:
 *  - A field the caller never sent (`undefined`) keeps whatever was already stored.
 *  - A field the caller did send is written, even when the value sent is blank (`''`, `false`, `0`).
 *  - A field explicitly sent as `null` is cleared, the key is dropped from the document so that
 *    the platform default applies again.
 *  - Nested objects are merged key by key, so naming one nested key leaves its siblings untouched.
 *  - Arrays are treated as a single value and are replaced wholesale when sent.
 */

const isMergeableObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Deeply merges the fields the caller actually sent (`patch`) over the currently stored
 * document (`base`) without dropping anything the caller left out.
 */
export function mergeDefinedFields<T>(base: T, patch: unknown): T {
    if (patch === undefined) {
        // Nothing was sent for this field, keep the stored value
        return base;
    }
    if (!isMergeableObject(patch) || !isMergeableObject(base)) {
        // Scalars, arrays, nulls and brand new objects replace the stored value
        return patch as unknown as T;
    }

    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const key of Object.keys(patch)) {
        const patchedValue = (patch as Record<string, unknown>)[key];
        if (patchedValue === undefined) {
            // The caller did not touch this key, leave the stored value in place
            continue;
        }
        if (patchedValue === null) {
            // The caller explicitly cleared this key, drop it so the default applies again
            delete merged[key];
            continue;
        }
        merged[key] = mergeDefinedFields(merged[key], patchedValue);
    }

    return merged as unknown as T;
}
