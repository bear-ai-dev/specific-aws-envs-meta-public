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
import { sendCustomerCommunicationEmail } from '../../utils/aws/ses.js';
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
        this.eventEmitter.on(customerCommunicationChannel, (publishRequest: CustomerCommunicationPublishRequest) =>
            processor.process(publishRequest),
        );
    }
    public listenerCount(customerCommunicationChannel: CustomerCommunicationChannel): number {
        return this.eventEmitter.listenerCount(customerCommunicationChannel);
    }
}

/**
 * Delivers every customer communication published on the EMAIL channel to the mail
 * provider. A single published event becomes a single message, addressed to the one
 * customer the event names. When the provider refuses the message, the refusal is
 * audited and swallowed so the next published communication is still delivered.
 */
export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);
    /** Deliveries are chained so communications reach the provider in the order published. */
    private deliveries: Promise<void> = Promise.resolve();

    process = (publishRequest: CustomerCommunicationPublishRequest): Promise<void> => {
        this.deliveries = this.deliveries.then(() => this.deliver(publishRequest));
        return this.deliveries;
    };

    private deliver = async (publishRequest: CustomerCommunicationPublishRequest): Promise<void> => {
        const [email] = publishRequest?.data ?? [];
        if (!email) {
            EmailCustomerCommunicationProcessor.logger.warn(
                'Customer communication published on the EMAIL channel carried no email to send',
            );
            return;
        }
        try {
            const { MessageId } = await sendCustomerCommunicationEmail(email);
            EmailCustomerCommunicationProcessor.logger.log(
                `Customer communication email sent to ${email.toEmail} with messageId ${MessageId}`,
            );
        } catch (e) {
            EmailCustomerCommunicationProcessor.logger.error(
                `Failed to send customer communication email to ${email?.toEmail}`,
            );
            EmailCustomerCommunicationProcessor.logger.error(serializeError(e));
            AuditService.publishEvent({
                topic: AuditScope.ERROR,
                message: `Failed to send customer communication email to ${email?.toEmail}`,
                data: [{ error: serializeError(e) }],
            });
        }
    };
}
