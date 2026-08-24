import { SESClient, SendEmailCommand, SendEmailCommandInput, SendEmailCommandOutput } from '@aws-sdk/client-ses';

const DEFAULT_REGION = 'us-east-1';

let sesClient: SESClient;

/**
 * A single SES client is reused for the lifetime of the process. It is built the
 * same way every other AWS client in this project is built, so the endpoint,
 * region and credentials come from the ambient AWS configuration.
 */
export const getSESClient = (): SESClient => {
    if (!sesClient) {
        sesClient = new SESClient({
            region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || DEFAULT_REGION,
        });
    }
    return sesClient;
};

export const sendEmail = async (input: SendEmailCommandInput): Promise<SendEmailCommandOutput> =>
    getSESClient().send(new SendEmailCommand(input));
