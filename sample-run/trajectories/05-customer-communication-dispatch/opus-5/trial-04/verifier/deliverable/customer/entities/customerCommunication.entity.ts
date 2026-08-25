import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';
import { SendEmailCommandInput } from '@aws-sdk/client-ses';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationEmail,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';
import { sendEmail } from '../../utils/aws/ses.js';

/**
 * Every message the mail provider accepts is framed the same way:
 * - the sender display name travels as a base64 encoded word, always, even when it is empty or
 *   plain ASCII, so any character set survives the header,
 * - the reply-to display name travels as written, unencoded,
 * - subject and body parts are declared as UTF-8,
 * - the send is attributed to the default configuration set,
 * - the message is addressed to the one customer it names, with no copies.
 */
export const EMAIL_CHARSET = 'UTF-8';
export const EMAIL_CONFIGURATION_SET = 'defaultConfigurationSet';

export const encodeEmailDisplayName = (displayName?: string): string =>
    `=?${EMAIL_CHARSET}?B?${Buffer.from(displayName ?? '', 'utf8').toString('base64')}?=`;

export const buildSendEmailInput = (email: CustomerCommunicationEmail): SendEmailCommandInput => {
    const body = email?.html
        ? { Html: { Charset: EMAIL_CHARSET, Data: email?.content } }
        : { Text: { Charset: EMAIL_CHARSET, Data: email?.content } };

    return {
        Source: `${encodeEmailDisplayName(email?.fromName)} <${email?.fromEmail}>`,
        Destination: { ToAddresses: [email?.toEmail] },
        Message: {
            Subject: { Charset: EMAIL_CHARSET, Data: email?.subject },
            Body: body,
        },
        ...(email?.replyToEmail ? { ReplyToAddresses: [`${email?.replyToName ?? ''} <${email?.replyToEmail}>`] } : {}),
        ConfigurationSetName: EMAIL_CONFIGURATION_SET,
    };
};

export class CustomerCommunicationEntity implements CustomerCommunication {
    private eventEmitter: EventEmitter;
    private registeredProcessors: Map<CustomerCommunicationChannel, Set<string>>;

    constructor(subscribeDefaultProcessors = true) {
        this.eventEmitter = new EventEmitter();
        this.registeredProcessors = new Map();
        if (subscribeDefaultProcessors) {
            // Without a subscriber on the mail channel every published communication is dropped on
            // the floor, so the mail processor is wired up as soon as the bus exists.
            this.subscribe(CustomerCommunicationChannel.EMAIL, new EmailCustomerCommunicationProcessor());
        }
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
        const registered = this.registeredProcessors.get(customerCommunicationChannel) ?? new Set<string>();
        const processorName = processor?.constructor?.name ?? 'AnonymousProcessor';
        // Subscribing the same processor twice would send every communication twice.
        if (registered.has(processorName)) {
            return;
        }
        registered.add(processorName);
        this.registeredProcessors.set(customerCommunicationChannel, registered);
        this.eventEmitter.on(customerCommunicationChannel, processor.process);
    }
}

export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);
    // Communications leave in the order the bus carried them, so sends are chained rather than raced.
    private static deliveries: Promise<void> = Promise.resolve();

    /**
     * Resolves once every communication handed over so far has been attempted.
     */
    public static async drain(): Promise<void> {
        await EmailCustomerCommunicationProcessor.deliveries;
    }

    public static async deliver(publishRequest: CustomerCommunicationPublishRequest): Promise<void> {
        const [email] = publishRequest?.data ?? [];
        if (!email) {
            // An event that names no customer puts no message on the wire.
            return;
        }
        const input = buildSendEmailInput(email);
        try {
            const { MessageId } = await sendEmail(input);
            EmailCustomerCommunicationProcessor.logger.log(
                `Sent customer communication to ${email?.toEmail} (${MessageId})`,
            );
        } catch (e) {
            // A refused recipient is this communication's problem alone: it is never re-addressed to
            // somebody else, and it never keeps the communications behind it from being delivered.
            EmailCustomerCommunicationProcessor.logger.error(
                `Failed to send customer communication to ${email?.toEmail}: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
            );
        }
    }

    // Declared as a property so the handler keeps its binding when it is registered on the bus.
    public process = (publishRequest: CustomerCommunicationPublishRequest): void => {
        EmailCustomerCommunicationProcessor.deliveries = EmailCustomerCommunicationProcessor.deliveries
            .catch(() => undefined)
            .then(() => EmailCustomerCommunicationProcessor.deliver(publishRequest));
    };
}
