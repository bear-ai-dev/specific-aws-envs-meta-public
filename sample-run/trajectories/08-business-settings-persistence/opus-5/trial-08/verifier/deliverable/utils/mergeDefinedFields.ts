/**
 * Utilities to support partial (PATCH like) updates over documents that are persisted in full.
 *
 * The rules implemented here are:
 *  - A field the caller did not send (`undefined`, or not present at all) keeps whatever was stored.
 *  - A field the caller did send is written, even if the value is blank (`''`, `0`, `false`).
 *    Emptying a value is a deliberate action and is not the same as never having sent it.
 *  - `null` counts as a value the caller sent, it clears the field: the merged document simply stops
 *    holding it, so it is not written and reading it back yields the default for that field.
 *  - Nested objects are merged with the same rules, recursively, so naming one nested entry
 *    leaves its siblings exactly as they were.
 *  - Arrays are replaced wholesale, they represent a complete collection rather than a set of fields.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const isMergeableObject = (value: any): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Merge the fields the caller actually sent (`incoming`) on top of what is currently stored (`existing`).
 * Neither argument is mutated.
 */
export const mergeDefinedFields = <T>(existing: T, incoming: Partial<T> = {} as Partial<T>): T => {
    const merged = { ...(isMergeableObject(existing) ? existing : ({} as T)) } as T;
    if (!isMergeableObject(incoming)) {
        return merged;
    }

    Object.keys(incoming).forEach((key) => {
        const incomingValue = incoming[key];
        // Not sent by the caller, keep whatever is stored
        if (incomingValue === undefined) {
            return;
        }
        // Sent as null, the caller is clearing the field
        if (incomingValue === null) {
            delete merged[key];
            return;
        }
        const existingValue = merged[key];
        if (isMergeableObject(incomingValue) && isMergeableObject(existingValue)) {
            merged[key] = mergeDefinedFields(existingValue, incomingValue);
        } else if (isMergeableObject(incomingValue)) {
            // Nothing stored to merge against, still merge onto an empty object so we get a plain copy
            merged[key] = mergeDefinedFields({}, incomingValue);
        } else {
            merged[key] = incomingValue;
        }
    });

    return merged;
};
