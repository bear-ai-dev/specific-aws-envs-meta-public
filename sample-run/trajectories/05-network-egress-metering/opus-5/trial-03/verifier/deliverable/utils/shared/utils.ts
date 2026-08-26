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

/**
 * Run an AWS call again when it comes back with a transient condition.
 *
 * Throttling and internal errors are the normal answer when a metering run
 * walks a large estate, and neither is an answer about the estate. Some AWS
 * clients fail to classify those replies themselves (their own retry handling
 * never engages), so calls which matter are wrapped in this.
 */
export const retryWithBackoff = async <T>(
    operation: () => Promise<T>,
    {
        attempts = 5,
        baseDelayInMs = 150,
        shouldRetry = () => true,
        onRetry,
    }: {
        attempts?: number;
        baseDelayInMs?: number;
        shouldRetry?: (error: any) => boolean;
        onRetry?: (error: any, attempt: number) => void;
    } = {},
): Promise<T> => {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            if (attempt === attempts || !shouldRetry(error)) {
                throw error;
            }
            if (onRetry) {
                onRetry(error, attempt);
            }
            await sleep(baseDelayInMs * 2 ** (attempt - 1));
        }
    }
    throw lastError;
};
