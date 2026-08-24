import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const getS3Client = () => new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });

export const putDocument = (document, Bucket, Key) =>
    new Upload({ client: getS3Client(), params: { Body: document, Bucket, Key } });

/**
 * Checks the existence of an object within a bucket. Only a response which actually describes
 * an object is treated as existing, anything else (a `NotFound`, or any other failure to look
 * the object up) reports the object as absent so callers are free to attempt their write.
 */
export const doesObjectExist = async (Bucket: string, Key: string): Promise<boolean> => {
    const client = getS3Client();
    try {
        const head = await client.send(new HeadObjectCommand({ Bucket, Key }));
        return Boolean(head?.ETag || head?.LastModified || head?.ContentLength !== undefined);
    } catch (e) {
        return false;
    }
};

/**
 * Writes a document to a bucket at the given key, but only when nothing is stored
 * at that key already. Existing documents are never overwritten.
 *
 * @returns `true` when the document was written, `false` when an object already exists at the key.
 */
export const putDocumentWithoutOverwrite = async (document, Bucket: string, Key: string): Promise<boolean> => {
    if (await doesObjectExist(Bucket, Key)) {
        return false;
    }
    const client = getS3Client();
    await client.send(new PutObjectCommand({ Bucket, Key, Body: document }));
    return true;
};
