import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';
import { serializeError } from 'serialize-error';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationEmail,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

/**
 * Delivers customer communications published on the EMAIL channel to the mail provider (SES).
 *
 * One published communication becomes exactly one message, addressed to the customer named by the
 * communication and to nobody else. If the provider refuses the message, the refusal is logged and
 * audited: no substitute recipient is attempted, and the communications published afterwards are
 * still delivered.
 */
export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);
    public static readonly CHARSET = 'UTF-8';
    public static readonly CONFIGURATION_SET = 'defaultConfigurationSet';

    private static sesClient: SESClient;
    /** Deliveries are chained so messages reach the provider in the order they were published. */
    private static deliveries: Promise<void> = Promise.resolve();

    public static client(): SESClient {
        if (!EmailCustomerCommunicationProcessor.sesClient) {
            EmailCustomerCommunicationProcessor.sesClient = new SESClient({
                region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
            });
        }
        return EmailCustomerCommunicationProcessor.sesClient;
    }

    /** A display name as an RFC 2047 base64 encoded word, so any character survives the wire. */
    public static encodeDisplayName(displayName?: string): string {
        return `=?${EmailCustomerCommunicationProcessor.CHARSET}?B?${Buffer.from(displayName ?? '', 'utf8').toString(
            'base64',
        )}?=`;
    }

    public static formatSource({ fromName, fromEmail }: CustomerCommunicationEmail): string {
        return `${EmailCustomerCommunicationProcessor.encodeDisplayName(fromName)} <${fromEmail}>`;
    }

    public static formatReplyTo({ replyToName, replyToEmail }: CustomerCommunicationEmail): string[] {
        if (!replyToEmail) {
            return [];
        }
        return [`${replyToName ?? ''} <${replyToEmail}>`.trim()];
    }

    public static buildSendEmailInput(email: CustomerCommunicationEmail): SendEmailCommandInput {
        const { CHARSET, CONFIGURATION_SET } = EmailCustomerCommunicationProcessor;
        const body = email.html
            ? { Html: { Data: email.content, Charset: CHARSET } }
            : { Text: { Data: email.content, Charset: CHARSET } };
        return {
            Source: EmailCustomerCommunicationProcessor.formatSource(email),
            Destination: { ToAddresses: [email.toEmail] },
            ReplyToAddresses: EmailCustomerCommunicationProcessor.formatReplyTo(email),
            Message: {
                Subject: { Data: email.subject, Charset: CHARSET },
                Body: body,
            },
            ConfigurationSetName: CONFIGURATION_SET,
        };
    }

    /** Resolves once every communication published so far has been offered to the provider. */
    public static flush(): Promise<void> {
        return EmailCustomerCommunicationProcessor.deliveries;
    }

    process = (publishRequest: CustomerCommunicationPublishRequest): void => {
        EmailCustomerCommunicationProcessor.deliveries = EmailCustomerCommunicationProcessor.deliveries
            .then(() => EmailCustomerCommunicationProcessor.deliver(publishRequest))
            .catch((error) => {
                // A failed communication must never take the next one down with it.
                EmailCustomerCommunicationProcessor.reportFailure(error);
            });
    };

    private static async deliver(publishRequest: CustomerCommunicationPublishRequest): Promise<void> {
        if (publishRequest?.topic !== CustomerCommunicationChannel.EMAIL) {
            return;
        }
        const [email] = publishRequest?.data ?? [];
        if (!email) {
            // Nothing was addressed, so nothing goes on the wire.
            return;
        }
        if (!email.toEmail) {
            EmailCustomerCommunicationProcessor.logger.warn(
                'Customer communication has no recipient. Nothing was sent.',
            );
            return;
        }
        try {
            const { MessageId } = await EmailCustomerCommunicationProcessor.client().send(
                new SendEmailCommand(EmailCustomerCommunicationProcessor.buildSendEmailInput(email)),
            );
            EmailCustomerCommunicationProcessor.logger.log(
                `Customer communication sent to ${email.toEmail}. MessageId: ${MessageId}`,
            );
        } catch (error) {
            EmailCustomerCommunicationProcessor.reportFailure(error, email);
        }
    }

    private static reportFailure(error: unknown, email?: CustomerCommunicationEmail): void {
        EmailCustomerCommunicationProcessor.logger.error(
            `Failed to send customer communication${email?.toEmail ? ` to ${email.toEmail}` : ''}`,
        );
        EmailCustomerCommunicationProcessor.logger.error(serializeError(error));
        AuditService.publishEvent({
            topic: AuditScope.ERROR,
            message: 'Failed to send customer communication',
            data: [{ error: serializeError(error), toEmail: email?.toEmail, subject: email?.subject }],
        });
    }
}

export class CustomerCommunicationEntity implements CustomerCommunication {
    public static readonly emailProcessor = new EmailCustomerCommunicationProcessor();

    private eventEmitter: EventEmitter;
    private registeredProcessors: Map<CustomerCommunicationChannel, Set<CustomerCommunicationProcessor>>;

    constructor() {
        this.eventEmitter = new EventEmitter();
        this.registeredProcessors = new Map();
        // Every communication system carries the mail channel, whether or not the module that owns it
        // got a chance to wire the processor up itself.
        this.subscribe(CustomerCommunicationChannel.EMAIL, CustomerCommunicationEntity.emailProcessor);
    }

    publish(publishRequest: CustomerCommunicationPublishRequest): CustomerCommunicationResponse {
        this.eventEmitter.emit(publishRequest.topic, publishRequest);
        return {
            message: 'Customer Communication Published',
            id: randomUUID(),
            data: [publishRequest],
        };
    }
    subscribe(customerCommunicationChannel: CustomerCommunicationChannel, processor: CustomerCommunicationProcessor) {
        const processors = this.registeredProcessors.get(customerCommunicationChannel) ?? new Set();
        if (processors.has(processor)) {
            // Subscribing the same processor twice would put every message on the wire twice.
            return;
        }
        processors.add(processor);
        this.registeredProcessors.set(customerCommunicationChannel, processors);
        this.eventEmitter.on(customerCommunicationChannel, processor.process);
    }
}
