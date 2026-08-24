import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';
import { serializeError } from 'serialize-error';
import { AuditService } from '../../audit/audit.service.js';
import { AuditScope } from '../../audit/entities/audit.interface.js';
import { sendEmail } from '../../utils/aws/ses.js';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';

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
 * One published event becomes exactly one message, addressed only to the
 * customer named on the event. A refusal from the provider (an unverified
 * sender, a suppressed recipient, ...) is recorded and swallowed so it neither
 * invents another recipient nor stops any communication published after it.
 */
export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);

    async process(publishRequest: CustomerCommunicationPublishRequest) {
        const [email] = publishRequest?.data ?? [];
        if (!email) {
            EmailCustomerCommunicationProcessor.logger.warn('No email found on customer communication, skipping send');
            return;
        }
        try {
            const messageId = await sendEmail(email);
            EmailCustomerCommunicationProcessor.logger.log(
                `Email sent to customer, messageId: ${messageId}, subject: ${email.subject}`,
            );
        } catch (e) {
            EmailCustomerCommunicationProcessor.logger.error(
                `Failed to send email to customer: ${email.toEmail}, subject: ${email.subject}`,
            );
            EmailCustomerCommunicationProcessor.logger.error(serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: 'Failed to send customer communication email',
                data: [{ error: serializeError(e), toEmail: email.toEmail, subject: email.subject }],
            });
        }
    }
}
