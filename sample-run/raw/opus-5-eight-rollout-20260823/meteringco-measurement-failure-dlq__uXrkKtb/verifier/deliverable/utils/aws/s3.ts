import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const putDocument = (document, Bucket, Key) =>
    new Upload({ client: new S3Client({ region: 'us-east-1' }), params: { Body: document, Bucket, Key } });

/**
 * Checks if an object already exists in a bucket.
 * Any error while checking (including a missing object) is treated as "not present",
 * the caller is expected to be resilient to that case.
 */
export const documentExists = async (Bucket: string, Key: string): Promise<boolean> => {
    try {
        await new S3Client({ region: 'us-east-1' }).send(new HeadObjectCommand({ Bucket, Key }));
        return true;
    } catch (e) {
        return false;
    }
};
