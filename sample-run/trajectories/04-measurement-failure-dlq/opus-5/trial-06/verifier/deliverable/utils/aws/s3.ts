import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const putDocument = (document, Bucket, Key) =>
    new Upload({ client: new S3Client({ region: 'us-east-1' }), params: { Body: document, Bucket, Key } });

/**
 * Checks whether an object already exists in the given bucket.
 * Any error other than a missing object is bubbled up to the caller.
 */
export const documentExists = async (Bucket: string, Key: string): Promise<boolean> => {
    const client = new S3Client({ region: 'us-east-1' });
    try {
        await client.send(new HeadObjectCommand({ Bucket, Key }));
        return true;
    } catch (e) {
        const statusCode = e?.$metadata?.httpStatusCode;
        if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || statusCode === 404) {
            return false;
        }
        throw e;
    }
};

/**
 * Writes a document to S3 without ever replacing an object which is already stored under the same key.
 * Returns the key which was used, or undefined when the object already exists.
 */
export const putDocumentIfAbsent = async (
    document: string,
    Bucket: string,
    Key: string,
): Promise<string | undefined> => {
    if (await documentExists(Bucket, Key)) {
        return undefined;
    }
    const client = new S3Client({ region: 'us-east-1' });
    await client.send(new PutObjectCommand({ Bucket, Key, Body: document }));
    return Key;
};
