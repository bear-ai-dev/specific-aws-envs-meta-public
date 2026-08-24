import { SendEmailCommand, SendEmailCommandInput, SendEmailCommandOutput, SESClient } from '@aws-sdk/client-ses';

/**
 * SES is reached with the same client construction the rest of the project uses: the region comes
 * from the environment and, when a dedicated pair of mail credentials is configured, it is used.
 * When it is not, the default credential chain of the runtime is used instead, so nothing is
 * overridden with `undefined`.
 */
export const buildSESClient = (): SESClient => {
    const region =
        process.env.AWS_SES_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const accessKeyId = process.env.AWS_SES_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SES_SECRET_ACCESS_KEY;

    return new SESClient({
        region,
        ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
};

export const sendEmail = async (input: SendEmailCommandInput): Promise<SendEmailCommandOutput> => {
    const client = buildSESClient();
    try {
        return await client.send(new SendEmailCommand(input));
    } finally {
        client.destroy();
    }
};
