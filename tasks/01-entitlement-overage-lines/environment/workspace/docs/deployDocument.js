const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { createReadStream } = require('fs');

(async () => {
    try {
        const file = './docs/private_api.html';
        const fileStream = createReadStream(file);
        const s3 = new S3Client({ region: 'us-east-2' });
        const bucketParams = {
            Bucket: 'meteringco-resources',
            Key: 'private_api.html',
            Body: fileStream,
            ContentType: 'text/html',
        };
        const data = await s3.send(new PutObjectCommand(bucketParams));
        return data;
    } catch (error) {
        console.log('An Error Occurred');
        throw error;
    }
})();

(async () => {
    try {
        const file = './docs/public_api.html';
        const fileStream = createReadStream(file);
        const s3 = new S3Client({ region: 'us-east-2' });
        const bucketParams = {
            Bucket: 'meteringco-public-information',
            Key: 'public_api.html',
            Body: fileStream,
            ContentType: 'text/html',
        };
        const data = await s3.send(new PutObjectCommand(bucketParams));
        return data;
    } catch (error) {
        console.log('An Error Occurred');
        throw error;
    }
})();

(async () => {
    try {
        const file = './docs/public_api.html';
        const fileStream = createReadStream(file);
        const s3 = new S3Client({ region: 'us-east-2' });
        const websiteBucketParams = {
            Bucket: 'www.api.docs.meteringco.example',
            Key: 'index.html',
            Body: fileStream,
            ContentType: 'text/html',
        };
        const data = await s3.send(new PutObjectCommand(websiteBucketParams));
        return data;
    } catch (error) {
        console.log('An Error Occurred');
        throw error;
    }
})();
