import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const putDocument = (document, Bucket, Key) =>
    new Upload({ client: new S3Client({ region: 'us-east-1' }), params: { Body: document, Bucket, Key } });

export const getDocument = async <T>(Bucket: string, Key: string): Promise<T> => {
    const client = new S3Client({});
    const { Body } = await client.send(new GetObjectCommand({ Bucket, Key }));
    return JSON.parse(await Body.transformToString()) as T;
};
