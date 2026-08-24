import { SendEmailCommand, SendEmailCommandOutput, SESClient } from '@aws-sdk/client-ses';
import { CustomerCommunicationEmail } from '../../customer/entities/customerCommunication.interface.js';

/**
 * Every part of a customer communication is framed as UTF-8 on the wire, and every
 * accepted send is attributed to the account's default configuration set.
 */
export const EMAIL_CHARSET = 'UTF-8';
export const DEFAULT_EMAIL_CONFIGURATION_SET = 'defaultConfigurationSet';

let sesClient: SESClient | undefined;

export const getSESClient = (): SESClient => {
    if (!sesClient) {
        sesClient = new SESClient({
            region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
        });
    }
    return sesClient;
};

/**
 * Display names travel as an RFC 2047 encoded word so that any character set survives
 * the trip. The encoded word is always emitted, even for an empty display name.
 */
export const encodeEmailDisplayName = (displayName?: string): string =>
    `=?${EMAIL_CHARSET}?B?${Buffer.from(displayName ?? '', 'utf8').toString('base64')}?=`;

export const formatEmailSender = (displayName: string | undefined, address: string): string =>
    `${encodeEmailDisplayName(displayName)} <${address}>`;

export const formatEmailReplyTo = (displayName: string | undefined, address: string): string =>
    [displayName, `<${address}>`].filter(Boolean).join(' ');

export const buildCustomerCommunicationEmailCommand = (email: CustomerCommunicationEmail): SendEmailCommand => {
    const { subject, fromName, fromEmail, toEmail, content, replyToName, replyToEmail, html } = email;
    const body = { Data: content, Charset: EMAIL_CHARSET };
    return new SendEmailCommand({
        Source: formatEmailSender(fromName, fromEmail),
        // One communication is delivered to exactly one recipient: the customer it names.
        Destination: { ToAddresses: [toEmail] },
        ReplyToAddresses: replyToEmail ? [formatEmailReplyTo(replyToName, replyToEmail)] : undefined,
        Message: {
            Subject: { Data: subject, Charset: EMAIL_CHARSET },
            Body: html ? { Html: body } : { Text: body },
        },
        ConfigurationSetName: DEFAULT_EMAIL_CONFIGURATION_SET,
    });
};

export const sendCustomerCommunicationEmail = async (
    email: CustomerCommunicationEmail,
): Promise<SendEmailCommandOutput> => getSESClient().send(buildCustomerCommunicationEmailCommand(email));
