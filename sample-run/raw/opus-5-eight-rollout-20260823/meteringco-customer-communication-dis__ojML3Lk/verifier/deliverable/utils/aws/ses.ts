import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export const CHARSET = 'UTF-8';
export const DEFAULT_CONFIGURATION_SET = 'defaultConfigurationSet';

let sesClient: SESClient;

export const getSESClient = (): SESClient => {
    if (!sesClient) {
        sesClient = new SESClient({ region: process.env.AWS_REGION || 'us-east-1' });
    }
    return sesClient;
};

/**
 * RFC 2047 base64 ("B") encoded-word, the framing used for the display name of
 * the envelope sender on the wire.
 */
export const encodeDisplayName = (name = ''): string =>
    `=?${CHARSET}?B?${Buffer.from(name ?? '', 'utf-8').toString('base64')}?=`;

export const formatSource = (fromName: string, fromEmail: string): string =>
    `${encodeDisplayName(fromName)} <${fromEmail}>`;

export const formatReplyTo = (replyToName: string, replyToEmail: string): string =>
    replyToName ? `${replyToName} <${replyToEmail}>` : `${replyToEmail}`;

export type SendEmailInput = {
    subject: string;
    fromName: string;
    fromEmail: string;
    toEmail: string;
    content: string;
    replyToName: string;
    replyToEmail: string;
    html?: boolean;
};

export const buildSendEmailCommand = ({
    subject,
    fromName,
    fromEmail,
    toEmail,
    content,
    replyToName,
    replyToEmail,
    html,
}: SendEmailInput): SendEmailCommand => {
    const body = html ? { Html: { Data: content, Charset: CHARSET } } : { Text: { Data: content, Charset: CHARSET } };
    return new SendEmailCommand({
        Source: formatSource(fromName, fromEmail),
        Destination: { ToAddresses: [toEmail] },
        ReplyToAddresses: replyToEmail ? [formatReplyTo(replyToName, replyToEmail)] : undefined,
        Message: {
            Subject: { Data: subject, Charset: CHARSET },
            Body: body,
        },
        ConfigurationSetName: DEFAULT_CONFIGURATION_SET,
    });
};

export const sendEmail = async (email: SendEmailInput): Promise<string> => {
    const { MessageId } = await getSESClient().send(buildSendEmailCommand(email));
    return MessageId;
};
