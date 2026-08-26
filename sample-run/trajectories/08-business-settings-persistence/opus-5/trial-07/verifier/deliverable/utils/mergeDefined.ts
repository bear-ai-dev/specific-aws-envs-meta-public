/**
 * Determines if a value can be recursively merged into another value.
 * Arrays, dates and primitives are replaced wholesale, plain objects (and class instances) are merged key by key.
 */
const isMergeable = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Recursively merges the keys of `patch` on top of `base`.
 * <br><br>
 * Only the keys present on `patch` are considered, keys the caller never sent (`undefined`) keep the value
 * held by `base`. A key that was sent is always written, even when the value sent is an empty string, `0` or
 * `false`, since clearing a value is an explicit action and is not the same as omitting it. A key sent as `null`
 * is removed from the merged document.
 * <br><br>
 * Nested objects are merged the same way, so patching one nested key leaves its siblings untouched.
 * Arrays are treated as values and therefore replaced, never merged element by element.
 *
 * @param base the currently stored document
 * @param patch the fields the caller named
 * @returns a new plain object holding the result of the merge
 */
export const mergeDefined = <Base, Patch>(base: Base, patch: Patch): Base & Patch => {
    const merged = (isMergeable(base) ? { ...base } : {}) as Record<string, unknown>;

    if (!isMergeable(patch)) {
        return merged as Base & Patch;
    }

    for (const key of Object.keys(patch)) {
        const patchValue = (patch as Record<string, unknown>)[key];
        // A key the caller did not send keeps whatever is already stored.
        if (patchValue === undefined) {
            continue;
        }
        // An explicit null clears the key, the merged document is left without it.
        if (patchValue === null) {
            delete merged[key];
            continue;
        }
        const baseValue = merged[key];
        merged[key] =
            isMergeable(patchValue) && isMergeable(baseValue) ? mergeDefined(baseValue, patchValue) : patchValue;
    }

    return merged as Base & Patch;
};
