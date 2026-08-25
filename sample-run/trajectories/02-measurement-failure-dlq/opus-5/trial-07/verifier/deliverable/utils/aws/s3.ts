import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const putDocument = (document, Bucket, Key) =>
    new Upload({ client: new S3Client({ region: 'us-east-1' }), params: { Body: document, Bucket, Key } });

/**
 * Writes a document to S3, the promise resolves once the object has been persisted.
 */
export const putObject = async (document, Bucket: string, Key: string) =>
    new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }).send(
        new PutObjectCommand({ Body: document, Bucket, Key }),
    );

/**
 * Checks if an object already exists in a bucket.
 * Any error which isn't a `404/NotFound` is bubbled up to the caller.
 */
export const objectExists = async (Bucket: string, Key: string): Promise<boolean> => {
    try {
        await new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' }).send(
            new HeadObjectCommand({ Bucket, Key }),
        );
        return true;
    } catch (e) {
        if (e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) {
            return false;
        }
        throw e;
    }
};
