import { SESClient, SendEmailCommand, SendEmailCommandInput, SendEmailCommandOutput } from '@aws-sdk/client-ses';

let sesClient: SESClient;

/**
 * The SES client used to deliver customer communications. A single client is reused so that
 * connections and credentials are not resolved again for every message.
 */
export const getSESClient = (): SESClient => {
    if (!sesClient) {
        sesClient = new SESClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1' });
    }
    return sesClient;
};

export const sendEmail = (sendEmailCommandInput: SendEmailCommandInput): Promise<SendEmailCommandOutput> =>
    getSESClient().send(new SendEmailCommand(sendEmailCommandInput));
