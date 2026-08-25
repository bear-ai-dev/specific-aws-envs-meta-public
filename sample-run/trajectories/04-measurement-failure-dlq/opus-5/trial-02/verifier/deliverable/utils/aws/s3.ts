import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const putDocument = (document, Bucket, Key) =>
    new Upload({ client: new S3Client({ region: 'us-east-1' }), params: { Body: document, Bucket, Key } });

/**
 * Checks if an object already exists in the given bucket, a missing object is _not_ an error.
 */
export const documentExists = async (Bucket: string, Key: string): Promise<boolean> => {
    const client = new S3Client({ region: 'us-east-1' });
    try {
        await client.send(new HeadObjectCommand({ Bucket, Key }));
        return true;
    } catch (e) {
        if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw e;
    }
};

/**
 * Raised when a key is already taken by an existing object, so the write was not performed.
 */
export class ObjectAlreadyExistsError extends Error {
    constructor(Bucket: string, Key: string) {
        super(`Object s3://${Bucket}/${Key} already exists, refusing to overwrite it`);
        this.name = 'ObjectAlreadyExistsError';
    }
}

/**
 * Writes a document to S3 without ever replacing an object which is already present under the given key.
 * Throws an ObjectAlreadyExistsError when the key is already taken, and any other error when the write failed.
 */
export const putDocumentWithoutOverwrite = async (document, Bucket: string, Key: string) => {
    const client = new S3Client({ region: 'us-east-1' });
    if (await documentExists(Bucket, Key)) {
        throw new ObjectAlreadyExistsError(Bucket, Key);
    }
    try {
        return await client.send(new PutObjectCommand({ Body: document, Bucket, Key }));
    } catch (e) {
        // A conditional write which lost the race against another writer of the same key
        if (e?.name === 'PreconditionFailed' || e?.$metadata?.httpStatusCode === 412) {
            throw new ObjectAlreadyExistsError(Bucket, Key);
        }
        throw e;
    }
};
