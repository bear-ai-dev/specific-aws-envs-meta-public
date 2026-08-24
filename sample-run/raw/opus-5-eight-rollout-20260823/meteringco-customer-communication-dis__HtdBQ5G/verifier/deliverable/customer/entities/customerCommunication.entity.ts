import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';
import { SendEmailCommandInput } from '@aws-sdk/client-ses';
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

/**
 * Delivers a customer communication published on the EMAIL channel to the mail
 * provider. One published event becomes exactly one message, addressed to the
 * customer named on the event. A message the provider refuses is reported and
 * dropped: no substitute recipient is used and the failure never prevents the
 * communications published after it from being delivered.
 */
export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);
    public static readonly CHARSET = 'UTF-8';
    public static readonly CONFIGURATION_SET = 'defaultConfigurationSet';

    /** `Display Name <local@domain>` with the display name RFC 2047 encoded. */
    public static encodeDisplayName(displayName?: string): string {
        return `=?${EmailCustomerCommunicationProcessor.CHARSET}?B?${Buffer.from(displayName ?? '', 'utf8').toString(
            'base64',
        )}?=`;
    }

    public static buildSendEmailInput(email: CustomerCommunicationEmail): SendEmailCommandInput {
        const { CHARSET, CONFIGURATION_SET } = EmailCustomerCommunicationProcessor;
        const body = email.html
            ? { Html: { Data: email.content ?? '', Charset: CHARSET } }
            : { Text: { Data: email.content ?? '', Charset: CHARSET } };

        const sendEmailInput: SendEmailCommandInput = {
            Source: `${EmailCustomerCommunicationProcessor.encodeDisplayName(email.fromName)} <${email.fromEmail}>`,
            Destination: { ToAddresses: [email.toEmail] },
            Message: {
                Subject: { Data: email.subject ?? '', Charset: CHARSET },
                Body: body,
            },
            ConfigurationSetName: CONFIGURATION_SET,
        };

        if (email.replyToEmail) {
            sendEmailInput.ReplyToAddresses = [`${email.replyToName ?? ''} <${email.replyToEmail}>`.trim()];
        }

        return sendEmailInput;
    }

    process = async (publishRequest: CustomerCommunicationPublishRequest): Promise<void> => {
        const [email] = publishRequest?.data ?? [];

        if (!email || !email.toEmail) {
            EmailCustomerCommunicationProcessor.logger.warn(
                'Customer communication published on the EMAIL channel without a recipient, nothing to send',
            );
            return;
        }

        try {
            const { MessageId } = await sendEmail(EmailCustomerCommunicationProcessor.buildSendEmailInput(email));
            EmailCustomerCommunicationProcessor.logger.log(
                `Customer communication delivered to ${email.toEmail} with message id ${MessageId}`,
            );
        } catch (e) {
            // The provider refused this message. It is dropped as it stands: no
            // other recipient is attempted and the error is not rethrown, so the
            // communications published afterwards are still delivered.
            EmailCustomerCommunicationProcessor.logger.error(
                `Failed to deliver customer communication to ${email.toEmail}`,
            );
            EmailCustomerCommunicationProcessor.logger.error(serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to deliver customer communication email',
                data: [{ toEmail: email.toEmail, subject: email.subject, error: serializeError(e) }],
            });
        }
    };
}

export class CustomerCommunicationEntity implements CustomerCommunication {
    private eventEmitter: EventEmitter;
    private defaultProcessorsAttached = false;

    constructor() {
        this.eventEmitter = new EventEmitter();
        this.attachDefaultProcessors();
    }

    /**
     * Wires the channel processors that ship with the bus. Idempotent, so the
     * application bootstrap can ask for them again without a communication being
     * delivered twice.
     */
    attachDefaultProcessors() {
        if (this.defaultProcessorsAttached) {
            return;
        }
        this.defaultProcessorsAttached = true;
        this.subscribe(CustomerCommunicationChannel.EMAIL, new EmailCustomerCommunicationProcessor());
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
