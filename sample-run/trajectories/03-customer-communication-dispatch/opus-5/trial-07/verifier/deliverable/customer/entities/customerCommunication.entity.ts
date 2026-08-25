import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';
import { serializeError } from 'serialize-error';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { sendCustomerCommunicationEmail } from '../../utils/aws/ses.js';

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
 * Delivers customer communications carried on the EMAIL channel to the mail
 * provider. One published event becomes one message, addressed only to the
 * customer the event names.
 *
 * A refusal from the provider (an unverified sender, a suppressed recipient,
 * a throttle) is audited and swallowed: no other recipient is substituted for
 * the one that was refused, and the failure is not allowed to escape into the
 * bus, where it would stop the communications published after it.
 */
export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);
    /**
     * Communications reach the provider one at a time, in the order the bus
     * carried them. A send that is refused settles the chain like any other, so
     * the communications published behind it are still delivered.
     */
    private static queue: Promise<void> = Promise.resolve();

    async process(publishRequest: CustomerCommunicationPublishRequest) {
        EmailCustomerCommunicationProcessor.queue = EmailCustomerCommunicationProcessor.queue.then(() =>
            EmailCustomerCommunicationProcessor.deliver(publishRequest),
        );
        return EmailCustomerCommunicationProcessor.queue;
    }

    private static async deliver(publishRequest: CustomerCommunicationPublishRequest) {
        const [email] = publishRequest?.data || [];
        if (!email) {
            EmailCustomerCommunicationProcessor.logger.warn(
                'Customer communication published on the EMAIL channel carried no email to send',
            );
            return;
        }
        try {
            const { MessageId } = await sendCustomerCommunicationEmail(email);
            EmailCustomerCommunicationProcessor.logger.log(
                `Sent customer communication email to customer. MessageId: ${MessageId}`,
            );
        } catch (e) {
            // The recipient the communication named was refused. Nothing is sent
            // in its place and the failure is not rethrown, so the next
            // communication on the channel is still delivered.
            EmailCustomerCommunicationProcessor.logger.error(
                `Failed to send customer communication email to ${email?.toEmail}`,
            );
            EmailCustomerCommunicationProcessor.logger.error(serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to send customer communication email',
                data: [{ toEmail: email?.toEmail, subject: email?.subject, error: serializeError(e) }],
            });
        }
    }
}
