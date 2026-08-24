import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';
import { serializeError } from 'serialize-error';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationEmail,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';
import { sendEmail } from '../../utils/aws/ses.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';

export class CustomerCommunicationEntity implements CustomerCommunication {
    private eventEmitter: EventEmitter;
    constructor() {
        this.eventEmitter = new EventEmitter();
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
        this.eventEmitter.on(customerCommunicationChannel, processor.process);
    }
}

/**
 * Delivers a customer communication published on the EMAIL channel through SES.
 *
 * A single published event becomes a single message, addressed to the one customer named by the
 * event. A message the provider refuses (an unverified sender, a suppressed recipient, ...) is
 * recorded and dropped: no other recipient is substituted for the one the event named and the
 * refusal never propagates back to the bus, so communications published afterwards are unaffected.
 */
export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);
    private static readonly CHARSET = 'UTF-8';
    private static readonly CONFIGURATION_SET = 'defaultConfigurationSet';
    /**
     * Messages leave in the order the bus carried the events. The chain never rejects, a message the
     * provider refuses is handled where it is sent, so a refusal cannot hold up what follows it.
     */
    private static deliveries: Promise<void> = Promise.resolve();

    /**
     * Bound on purpose: the bus hands this method to an EventEmitter, which would otherwise call it
     * without its instance.
     */
    public process = (publishRequest: CustomerCommunicationPublishRequest): Promise<void> => {
        EmailCustomerCommunicationProcessor.deliveries = EmailCustomerCommunicationProcessor.deliveries.then(() =>
            EmailCustomerCommunicationProcessor.deliver(publishRequest),
        );
        return EmailCustomerCommunicationProcessor.deliveries;
    };

    private static deliver = async (publishRequest: CustomerCommunicationPublishRequest): Promise<void> => {
        const [email, ...additionalRecipients] = publishRequest?.data || [];
        if (!email?.toEmail) {
            EmailCustomerCommunicationProcessor.logger.warn(
                `Customer communication published with no recipient, nothing to send: ${publishRequest?.message}`,
            );
            return;
        }
        if (additionalRecipients.length) {
            EmailCustomerCommunicationProcessor.logger.warn(
                `Customer communication published for more than one recipient, sending to ${email.toEmail} only`,
            );
        }
        try {
            const { MessageId } = await sendEmail(EmailCustomerCommunicationProcessor.buildSendEmailInput(email));
            EmailCustomerCommunicationProcessor.logger.log(
                `Sent customer communication to ${email.toEmail}, messageId: ${MessageId}`,
            );
        } catch (e) {
            EmailCustomerCommunicationProcessor.logger.error(
                `Failed to send customer communication to ${email.toEmail}`,
            );
            EmailCustomerCommunicationProcessor.logger.error(serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Failed to send customer communication to ${email.toEmail}`,
                data: [{ error: serializeError(e), subject: email.subject, toEmail: email.toEmail }],
            });
        }
    };

    private static buildSendEmailInput(email: CustomerCommunicationEmail) {
        const { CHARSET, CONFIGURATION_SET } = EmailCustomerCommunicationProcessor;
        const body = { Charset: CHARSET, Data: email.content || '' };
        return {
            Source: EmailCustomerCommunicationProcessor.buildSource(email),
            Destination: { ToAddresses: [email.toEmail] },
            ReplyToAddresses: EmailCustomerCommunicationProcessor.buildReplyToAddresses(email),
            ConfigurationSetName: CONFIGURATION_SET,
            Message: {
                Subject: { Charset: CHARSET, Data: email.subject || '' },
                Body: email.html ? { Html: body } : { Text: body },
            },
        };
    }

    /**
     * The from name travels as an RFC 2047 base64 encoded word so that any character set survives
     * the header, the from address as the angle addressed part next to it.
     */
    private static buildSource({ fromName, fromEmail }: CustomerCommunicationEmail) {
        const encodedFromName = Buffer.from(fromName || '', 'utf-8').toString('base64');
        return `=?${EmailCustomerCommunicationProcessor.CHARSET}?B?${encodedFromName}?= <${fromEmail}>`;
    }

    private static buildReplyToAddresses({ replyToName, replyToEmail }: CustomerCommunicationEmail) {
        if (!replyToEmail) {
            return [];
        }
        return [replyToName ? `${replyToName} <${replyToEmail}>` : replyToEmail];
    }
}
