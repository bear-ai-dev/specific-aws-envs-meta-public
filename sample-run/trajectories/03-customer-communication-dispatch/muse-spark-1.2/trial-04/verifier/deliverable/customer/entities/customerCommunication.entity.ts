import { randomUUID } from 'crypto';
import EventEmitter from 'events';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
    CustomerCommunication,
    CustomerCommunicationChannel,
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
    CustomerCommunicationResponse,
} from './customerCommunication.interface.js';

// Lazy SES client singleton using preconfigured env
let _sesClient: SESClient | null = null;
function sesClient(): SESClient {
    if (_sesClient) return _sesClient;
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
    const endpoint = process.env.AWS_ENDPOINT_URL;
    _sesClient = new SESClient({
        region,
        endpoint,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID || '[REDACTED_AWS_ACCESS_KEY_ID]',
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '[REDACTED_AWS_SECRET_ACCESS_KEY]',
        },
    });
    return _sesClient;
}

async function sendViaSES(email: any) {
    try {
        const fromNameB64 = Buffer.from(email.fromName ?? '', 'utf-8').toString('base64');
        const source = `=?UTF-8?B?${fromNameB64}?= <${email.fromEmail}>`;
        const replyTo = `${email.replyToName} <${email.replyToEmail}>`;
        const isHtml = email.html === true;
        const command = new SendEmailCommand({
            Source: source,
            Destination: { ToAddresses: [email.toEmail] },
            Message: {
                Subject: { Data: email.subject, Charset: 'UTF-8' },
                Body: isHtml
                    ? { Html: { Data: email.content, Charset: 'UTF-8' } }
                    : { Text: { Data: email.content, Charset: 'UTF-8' } },
            },
            ReplyToAddresses: [replyTo],
            ConfigurationSetName: 'defaultConfigurationSet',
        });
        await sesClient().send(command);
    } catch (_err: any) {
        // If provider refuses recipient, do not invent fallback and do not stop later communications
    }
}

export class CustomerCommunicationEntity implements CustomerCommunication {
    private eventEmitter: EventEmitter;
    constructor() {
        this.eventEmitter = new EventEmitter();
    }

    publish(publishRequest: CustomerCommunicationPublishRequest): CustomerCommunicationResponse {
        this.eventEmitter.emit(publishRequest.topic, publishRequest);
        if (publishRequest.topic === CustomerCommunicationChannel.EMAIL) {
            const data: any = (publishRequest as any).data;
            if (Array.isArray(data) && data.length > 0) {
                const email = data[0];
                if (email) {
                    void sendViaSES(email).catch(() => {});
                }
            }
        }
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
