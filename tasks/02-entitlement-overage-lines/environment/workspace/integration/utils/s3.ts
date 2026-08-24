import { ListObjectsV2Command, PutObjectCommand, S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';

export const putDocument = async (
    Body,
    Bucket,
    Key,
    region: string = 'us-east-1',
    accessKeyId: string = process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: string = process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: string = ''
) => {
    const params = { Bucket, Key, Body };
    const s3client = new S3Client({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
            sessionToken,
        },
    });
    const data = await s3client.send(new PutObjectCommand(params));
    return data;
};

export const listDocuments = async (
    Bucket,
    Prefix,
    region: string = 'us-east-1',
    accessKeyId: string = process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: string = process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: string = ''
) => {
    const params = { Bucket, Prefix };
    const s3client = new S3Client({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
            sessionToken,
        },
    });
    const data = await s3client.send(new ListObjectsV2Command(params));
    return data;
};

export const getDocument = async (
    Bucket,
    Key,
    region: string = 'us-east-1',
    accessKeyId: string = process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: string = process.env.AWS_SECRET_ACCESS_KEY,
    sessionToken: string = ''
) => {
    const params = { Bucket, Key };
    const s3client = new S3Client({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
            sessionToken,
        },
    });
    const data = await s3client.send(new GetObjectCommand(params));
    return data;
};
