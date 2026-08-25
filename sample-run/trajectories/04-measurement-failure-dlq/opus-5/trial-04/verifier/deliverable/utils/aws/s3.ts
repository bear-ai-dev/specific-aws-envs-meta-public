import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const putDocument = (document, Bucket, Key) =>
    new Upload({ client: new S3Client({ region: 'us-east-1' }), params: { Body: document, Bucket, Key } });

/**
 * Checks if an object already exists in a bucket, it is used to avoid overwriting objects which
 * have already been written, for example a previously stored dead letter message.
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
