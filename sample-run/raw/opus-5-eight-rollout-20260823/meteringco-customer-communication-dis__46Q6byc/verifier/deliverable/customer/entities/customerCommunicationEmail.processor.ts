import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import { serializeError } from 'serialize-error';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import {
    CustomerCommunicationEmail,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
} from './customerCommunication.interface.js';

/**
 * Every customer communication published on the EMAIL channel is delivered to
 * SES by this processor. A single published event carries a single message for
 * a single named customer: the first entry of the event payload is the message,
 * and its `toEmail` is the only recipient the message is addressed to. No other
 * address (and no other payload entry) is ever used as a fallback recipient, and
 * a message SES refuses is logged and dropped without stopping the delivery of
 * later communications.
 */
export class CustomerCommunicationEmailProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(CustomerCommunicationEmailProcessor.name);
    // The charset every header and body part is framed with on the wire.
    public static readonly CHARSET = 'UTF-8';
    // The configuration set every send is attributed to.
    public static readonly CONFIGURATION_SET = 'defaultConfigurationSet';

    private static sesClient?: SESClient;

    public static getClient(): SESClient {
        if (!CustomerCommunicationEmailProcessor.sesClient) {
            CustomerCommunicationEmailProcessor.sesClient = new SESClient({
                region: process.env.AWS_SES_REGION || process.env.AWS_REGION || 'us-east-1',
                ...(process.env.AWS_SES_ACCESS_KEY_ID && process.env.AWS_SES_SECRET_ACCESS_KEY
                    ? {
                          credentials: {
                              accessKeyId: process.env.AWS_SES_ACCESS_KEY_ID,
                              secretAccessKey: process.env.AWS_SES_SECRET_ACCESS_KEY,
                          },
                      }
                    : {}),
            });
        }
        return CustomerCommunicationEmailProcessor.sesClient;
    }

    /**
     * Display names of the sender are framed as an RFC 2047 base64 encoded word
     * so that any name survives the wire, including an empty one.
     */
    public static encodedWord(value?: string): string {
        const encoded = Buffer.from(value || '', 'utf8').toString('base64');
        return `=?${CustomerCommunicationEmailProcessor.CHARSET}?B?${encoded}?=`;
    }

    public static source(email: CustomerCommunicationEmail): string {
        return `${CustomerCommunicationEmailProcessor.encodedWord(email?.fromName)} <${email?.fromEmail}>`;
    }

    public static replyToAddresses(email: CustomerCommunicationEmail): string[] {
        if (!email?.replyToEmail) {
            return [];
        }
        return [email?.replyToName ? `${email.replyToName} <${email.replyToEmail}>` : `${email.replyToEmail}`];
    }

    public static buildSendEmailInput(email: CustomerCommunicationEmail): SendEmailCommandInput {
        const { CHARSET, CONFIGURATION_SET } = CustomerCommunicationEmailProcessor;
        const body = email?.html
            ? { Html: { Charset: CHARSET, Data: email?.content } }
            : { Text: { Charset: CHARSET, Data: email?.content } };
        return {
            // The named customer of the communication is the only recipient.
            Destination: { ToAddresses: [email?.toEmail] },
            Message: {
                Subject: { Charset: CHARSET, Data: email?.subject },
                Body: body,
            },
            Source: CustomerCommunicationEmailProcessor.source(email),
            ReplyToAddresses: CustomerCommunicationEmailProcessor.replyToAddresses(email),
            ConfigurationSetName: CONFIGURATION_SET,
        };
    }

    // Sends are chained so that communications reach the provider in the order
    // the bus carried them, however quickly they are published.
    private static inFlight: Promise<void> = Promise.resolve();

    /**
     * Arrow function so that the processor keeps its identity when it is handed
     * to the event emitter as a bare listener.
     */
    process = (customerCommunicationPublishRequest: CustomerCommunicationPublishRequest): Promise<void> => {
        CustomerCommunicationEmailProcessor.inFlight = CustomerCommunicationEmailProcessor.inFlight.then(() =>
            CustomerCommunicationEmailProcessor.deliver(customerCommunicationPublishRequest),
        );
        return CustomerCommunicationEmailProcessor.inFlight;
    };

    private static deliver = async (
        customerCommunicationPublishRequest: CustomerCommunicationPublishRequest,
    ): Promise<void> => {
        const [email] = customerCommunicationPublishRequest?.data || [];
        if (!email) {
            CustomerCommunicationEmailProcessor.logger.warn(
                'Customer communication published on the email channel carried no message to send',
            );
            return;
        }
        try {
            const command = new SendEmailCommand(CustomerCommunicationEmailProcessor.buildSendEmailInput(email));
            const { MessageId } = await CustomerCommunicationEmailProcessor.getClient().send(command);
            CustomerCommunicationEmailProcessor.logger.log(
                `Sent customer communication ${MessageId} to ${email?.toEmail}`,
            );
        } catch (e) {
            // A refused message is dropped: no other recipient is attempted and
            // the failure is not allowed to escape and stop later communications.
            CustomerCommunicationEmailProcessor.logger.error(
                `Failed to send customer communication to ${email?.toEmail}`,
            );
            CustomerCommunicationEmailProcessor.logger.error(serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to send customer communication email',
                data: [{ error: serializeError(e), subject: email?.subject, toEmail: email?.toEmail }],
            });
        }
    };
}
