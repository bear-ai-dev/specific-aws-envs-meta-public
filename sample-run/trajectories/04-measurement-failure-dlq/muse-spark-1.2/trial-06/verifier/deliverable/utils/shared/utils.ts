/**
 * Group array of objects by given keys
 * @param keys keys to be grouped by
 * @param array objects to be grouped
 * @returns an object with objects in `array` grouped by `keys`
 * @see <https://gist.github.com/mikaello/06a76bca33e5d79cdd80c162d7774e9c>
 */
export const ArrayGroupBy =
    <T>(keys: (keyof T)[]) =>
    (array: T[]): Record<string, T[]> =>
        array.reduce(
            (objectsByKeyValue, obj) => {
                const value = keys.map((key) => obj[key]).join('-');
                objectsByKeyValue[value] = (objectsByKeyValue[value] || []).concat(obj);
                return objectsByKeyValue;
            },
            {} as Record<string, T[]>,
        );

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const suffixIfNotEmpty =
    (suffix: string) =>
    (str: string): string =>
        str !== '' ? `${str}${suffix}` : str;

export const joinMetadataObjectsAndRemoveNulls = <T extends Record<string, unknown>>(
    oldMetadata?: T | null | undefined,
    newMetadata?: T | null | undefined,
) => {
    if (!oldMetadata && newMetadata === undefined) {
        return undefined;
    }
    if (newMetadata === null) {
        return undefined;
    }
    if (newMetadata && !oldMetadata) {
        return newMetadata;
    }

    if (oldMetadata && newMetadata) {
        const metadata = { ...oldMetadata, ...newMetadata };

        Object.entries(metadata).forEach(([key, value]) => {
            if (value === null) {
                delete metadata[key];
            }
        });
        return metadata;
    }
};
