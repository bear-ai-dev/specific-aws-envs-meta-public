import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';

export class CustomerCommunicationEntity implements CustomerCommunication {
    private eventEmitter: EventEmitter;
    private queue: Promise<void> = Promise.resolve();
    private static readonly logger = new Logger(CustomerCommunicationEntity.name);

    constructor() {
        this.eventEmitter = new EventEmitter();
    }

    publish(publishRequest: CustomerCommunicationPublishRequest): CustomerCommunicationResponse {
        this.eventEmitter.emit(publishRequest.topic, publishRequest);
        if (publishRequest.topic === CustomerCommunicationChannel.EMAIL) {
            // chain to preserve order, swallow errors so later communications are not stopped
            this.queue = this.queue.catch(() => {}).then(() => this.deliverEmail(publishRequest)).catch(() => {});
        }
        return {
            message: 'Customer Communication Published',
            id: randomUUID(),
            data: [publishRequest],
        };
    }

    private async deliverEmail(request: CustomerCommunicationPublishRequest): Promise<void> {
        try {
            if (!request.data || request.data.length === 0) {
                return;
            }
            // One event must become one message addressed only to its named customer
            const entry = request.data[0];
            if (!entry || !entry.toEmail) {
                return;
            }
            const fromName = entry.fromName ?? '';
            const encodedFromName = Buffer.from(fromName, 'utf-8').toString('base64');
            const source = `=?UTF-8?B?${encodedFromName}?= <${entry.fromEmail}>`;
            const replyTo = `${entry.replyToName} <${entry.replyToEmail}>`;

            const subject = {
                Data: entry.subject,
                Charset: 'UTF-8',
            };

            let body: any;
            if (entry.html === true) {
                body = {
                    Html: {
                        Data: entry.content,
                        Charset: 'UTF-8',
                    },
                };
            } else {
                body = {
                    Text: {
                        Data: entry.content,
                        Charset: 'UTF-8',
                    },
                };
            }

            const sesClient = new SESClient({
                region: process.env.AWS_REGION || 'us-east-1',
                endpoint: process.env.AWS_ENDPOINT_URL,
            });

            const command = new SendEmailCommand({
                Source: source,
                Destination: {
                    ToAddresses: [entry.toEmail],
                },
                Message: {
                    Subject: subject,
                    Body: body,
                },
                ReplyToAddresses: [replyTo],
                ConfigurationSetName: 'defaultConfigurationSet',
            });

            await sesClient.send(command);
        } catch (e: any) {
            // If provider refuses that recipient (MessageRejected due to suppressed), do not fallback and do not stop later
            const code = e?.Code || e?.name || e?.__type || '';
            const msg = e?.message || '';
            if (code === 'MessageRejected' || msg.includes('suppression') || msg.includes('MessageRejected') || code.includes('MessageRejected')) {
                CustomerCommunicationEntity.logger.warn(`SES rejected recipient: ${msg || code}`);
            } else {
                CustomerCommunicationEntity.logger.error(`SES send failed: ${msg || errToString(e)}`);
            }
            // swallow error to allow next events
        }
    }

    subscribe(customerCommunicationChannel: CustomerCommunicationChannel, processor: CustomerCommunicationProcessor) {
        this.eventEmitter.on(customerCommunicationChannel, (req: CustomerCommunicationPublishRequest) => {
            try {
                processor.process(req);
            } catch (e) {
                CustomerCommunicationEntity.logger.error(`Processor error: ${e}`);
            }
        });
    }

    // helper to await all queued sends (useful for tests/verifier)
    async flush(): Promise<void> {
        await this.queue;
    }
}

function errToString(e: any): string {
    try {
        return JSON.stringify(e);
    } catch {
        return String(e);
    }
}
