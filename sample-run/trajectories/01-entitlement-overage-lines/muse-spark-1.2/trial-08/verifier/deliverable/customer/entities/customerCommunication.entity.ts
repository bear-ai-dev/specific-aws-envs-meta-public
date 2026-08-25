import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import EventEmitter from 'events';
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

export class CustomerEmailProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(CustomerEmailProcessor.name);
    async process({ data }: CustomerCommunicationPublishRequest) {
        CustomerEmailProcessor.logger.log('Sending Email to Customer');
        const [email] = data;
        try {
            CustomerEmailProcessor.logger.log(
                `Email sending parameters, subject: ${email.subject}, fromName: ${email.fromName} fromEmail" ${email.fromEmail} toEmail: ${email.toEmail} replyToName: ${email.replyToEmail} replyToEmail: ${email.replyToEmail}`,
            );
            await sendEmail(
                email.subject,
                email.fromName,
                email.fromEmail,
                email.toEmail,
                email.content,
                email.replyToName,
                email.replyToEmail,
                email?.html,
            );
        } catch (e) {
            CustomerEmailProcessor.logger.error(`An error occured while processing the email to ${email.toEmail}`);
            CustomerEmailProcessor.logger.error(e);
            AuditService.publishEvent({
                data: [serializeError(e)],
                message: 'Failed to process email',
                topic: AuditScope.ERROR,
            });
        }
    }
}
