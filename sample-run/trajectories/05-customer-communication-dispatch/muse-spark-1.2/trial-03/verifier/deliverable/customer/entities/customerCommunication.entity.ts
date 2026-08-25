import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';

export class CustomerCommunicationEntity implements CustomerCommunication {
    private eventEmitter: EventEmitter;
    private sesClient: SESClient;
    private readonly logger = new Logger(CustomerCommunicationEntity.name);
    private queue: Promise<void> = Promise.resolve();

    constructor() {
        this.eventEmitter = new EventEmitter();
        this.sesClient = new SESClient({
            region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1',
            endpoint: process.env.AWS_ENDPOINT_URL,
            credentials: process.env.AWS_ACCESS_KEY_ID
                ? {
                      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
                  }
                : undefined,
        });
        // Internal mail channel bridge: deliver each published EMAIL communication
        // via SES using the wire convention observed in dispatch-capture/ses-outbox.jsonl
        this.eventEmitter.on(CustomerCommunicationChannel.EMAIL, (req: CustomerCommunicationPublishRequest) => {
            // chain to preserve order of events; do not let one failure stop later events
            this.queue = this.queue
                .then(() => this.handleEmail(req))
                .catch((e) => {
                    this.logger.warn(`CustomerCommunication EMAIL queue error: ${e?.message || e}`);
                });
        });
    }

    private handleEmail = async (request: CustomerCommunicationPublishRequest): Promise<void> => {
        if (!request?.data || request.data.length === 0) {
            return;
        }
        for (const email of request.data) {
            try {
                const fromNameB64 = Buffer.from(email.fromName ?? '', 'utf-8').toString('base64');
                const source = `=?UTF-8?B?${fromNameB64}?= <${email.fromEmail}>`;
                const replyTo = `${email.replyToName} <${email.replyToEmail}>`;
                const isHtml = email.html === true;
                const command = new SendEmailCommand({
                    Source: source,
                    Destination: { ToAddresses: [email.toEmail] },
                    Message: {
                        Subject: { Charset: 'UTF-8', Data: email.subject },
                        Body: isHtml
                            ? { Html: { Charset: 'UTF-8', Data: email.content } }
                            : { Text: { Charset: 'UTF-8', Data: email.content } },
                    },
                    ReplyToAddresses: [replyTo],
                    ConfigurationSetName: 'defaultConfigurationSet',
                });
                await this.sesClient.send(command);
            } catch (e: any) {
                const msg = e?.message || String(e);
                this.logger.warn(`Failed to send email to ${email.toEmail}: ${msg}`);
                // do not invent fallback recipient; continue to next email / event
                continue;
            }
        }
    };

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
