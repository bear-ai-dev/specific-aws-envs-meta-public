import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';

export const assumeRole = async (
    roleArn: string,
    externalId: string = '',
    region: string = 'us-east-1',
    accessKeyId: string = process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: string = process.env.AWS_SECRET_ACCESS_KEY
) => {
    const client = new STSClient({
        region,
        credentials: {
            accessKeyId,
            secretAccessKey,
        },
    });
    const params = {
        RoleArn: roleArn,
        RoleSessionName: 'RoleSessionName',
        ExternalId: externalId,
    };
    const command = new AssumeRoleCommand(params);
    const response = await client.send(command);
    return response.Credentials;
};
