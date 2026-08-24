import { SESClient, SendEmailCommand, SendEmailCommandOutput } from '@aws-sdk/client-ses';
import { CustomerCommunicationEmail } from '../../customer/entities/customerCommunication.interface.js';

/**
 * Charset every part of a customer communication is framed with on the wire.
 */
export const EMAIL_CHARSET = 'UTF-8';

/**
 * Configuration set every customer communication send is attributed to.
 */
export const EMAIL_CONFIGURATION_SET = 'defaultConfigurationSet';

let sesClient: SESClient;

/**
 * Single SES client for the process. Region (and, in a sandbox, the endpoint)
 * comes from the environment the same way the other AWS clients in the project
 * pick them up.
 */
export const getSESClient = (): SESClient => {
    if (!sesClient) {
        sesClient = new SESClient({ region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1' });
    }
    return sesClient;
};

/**
 * RFC 2047 encoded word, base64 flavour. The sender display name is always
 * encoded, even when it is plain ASCII or empty, so a name carrying accents,
 * umlauts or CJK characters survives the trip untouched.
 */
export const encodeDisplayName = (name?: string): string =>
    `=?${EMAIL_CHARSET}?B?${Buffer.from(name || '', 'utf-8').toString('base64')}?=`;

/**
 * `Source` header: encoded display name followed by the bare address in angle
 * brackets.
 */
export const formatSourceAddress = (name: string | undefined, address: string): string =>
    `${encodeDisplayName(name)} <${address}>`;

/**
 * `Reply-To` header: display name as given, followed by the bare address.
 */
export const formatReplyToAddress = (name: string | undefined, address: string): string =>
    name ? `${name} <${address}>` : address;

/**
 * Hand a single customer communication to the mail provider. Exactly one
 * message is sent, addressed to the one customer the communication names: no
 * additional recipients are added, and nothing is copied to anybody else.
 */
export const sendCustomerCommunicationEmail = async (
    email: CustomerCommunicationEmail,
): Promise<SendEmailCommandOutput> => {
    const body = email?.html
        ? { Html: { Charset: EMAIL_CHARSET, Data: email?.content } }
        : { Text: { Charset: EMAIL_CHARSET, Data: email?.content } };

    return getSESClient().send(
        new SendEmailCommand({
            Source: formatSourceAddress(email?.fromName, email?.fromEmail),
            Destination: { ToAddresses: [email?.toEmail] },
            ...(email?.replyToEmail
                ? { ReplyToAddresses: [formatReplyToAddress(email?.replyToName, email?.replyToEmail)] }
                : {}),
            Message: {
                Subject: { Charset: EMAIL_CHARSET, Data: email?.subject },
                Body: body,
            },
            ConfigurationSetName: EMAIL_CONFIGURATION_SET,
        }),
    );
};
