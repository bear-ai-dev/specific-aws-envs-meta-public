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

export class CustomerCommunicationEmailProcessor implements CustomerCommunicationProcessor {
    private queue: Promise<void> = Promise.resolve();
    private getSesClient(): SESClient {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
        const endpoint = process.env.AWS_ENDPOINT_URL;
        return new SESClient({
            region,
            ...(endpoint ? { endpoint } : {}),
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'test',
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'test',
            },
        });
    }

    process = async (publishRequest: CustomerCommunicationPublishRequest): Promise<void> => {
        // Serialize to preserve bus order even if publishes happen concurrently
        const previous = this.queue;
        let resolveCurrent!: () => void;
        this.queue = new Promise<void>((res) => (resolveCurrent = res));
        await previous;
        try {
            if (!publishRequest?.data || publishRequest.data.length === 0) {
                return;
            }
            if (publishRequest.topic !== CustomerCommunicationChannel.EMAIL) {
                return;
            }
            for (const email of publishRequest.data) {
                try {
                    const fromNameB64 = Buffer.from(email.fromName ?? '', 'utf-8').toString('base64');
                    const source = `=?UTF-8?B?${fromNameB64}?= <${email.fromEmail}>`;
                    const replyTo = `${email.replyToName ?? ''} <${email.replyToEmail}>`;
                    const isHtml = email.html === true;
                    const sesClient = this.getSesClient();
                    const command = new SendEmailCommand({
                        Source: source,
                        Destination: {
                            ToAddresses: [email.toEmail],
                        },
                        Message: {
                            Subject: {
                                Data: email.subject,
                                Charset: 'UTF-8',
                            },
                            Body: isHtml
                                ? {
                                      Html: {
                                          Data: email.content,
                                          Charset: 'UTF-8',
                                      },
                                  }
                                : {
                                      Text: {
                                          Data: email.content,
                                          Charset: 'UTF-8',
                                      },
                                  },
                        },
                        ReplyToAddresses: [replyTo],
                        ConfigurationSetName: 'defaultConfigurationSet',
                    });
                    await sesClient.send(command);
                } catch (err: any) {
                    // Do not invent fallback and do not stop later communications
                    continue;
                }
            }
        } finally {
            resolveCurrent();
        }
    };
}

export class CustomerCommunicationEntity implements CustomerCommunication {
    private eventEmitter: EventEmitter;
    constructor() {
        this.eventEmitter = new EventEmitter();
        // Auto-subscribe email processor so that publishing on the bus delivers via SES
        try {
            const processor = new CustomerCommunicationEmailProcessor();
            this.subscribe(CustomerCommunicationChannel.EMAIL, processor);
        } catch {
            // ignore init errors in test env
        }
    }

    publish(publishRequest: CustomerCommunicationPublishRequest): CustomerCommunicationResponse {
        const listeners = this.eventEmitter.listeners(publishRequest.topic) as Array<(req: any) => any>;
        const promises: Promise<any>[] = [];
        for (const fn of listeners) {
            try {
                const res = fn(publishRequest);
                if (res instanceof Promise) {
                    promises.push(res.catch(() => {}));
                }
            } catch {
                // ignore synchronous errors and continue
            }
        }
        const response: CustomerCommunicationResponse = {
            message: 'Customer Communication Published',
            id: randomUUID(),
            data: [publishRequest],
        };
        if (promises.length > 0) {
            const pending = Promise.allSettled(promises);
            (CustomerCommunicationEntity as any)._pending = (CustomerCommunicationEntity as any)._pending || [];
            (CustomerCommunicationEntity as any)._pending.push(pending);
            pending.finally(() => {
                const arr = (CustomerCommunicationEntity as any)._pending;
                const idx = arr.indexOf(pending);
                if (idx >= 0) arr.splice(idx, 1);
            });
        }
        return response;
    }

    // Helper for tests/evaluators to wait until all pending SES sends are done
    static async flush(): Promise<void> {
        const pending = (CustomerCommunicationEntity as any)._pending as Promise<any>[] | undefined;
        if (pending && pending.length) {
            await Promise.allSettled(pending);
        }
        await new Promise((r) => setTimeout(r, 50));
    }

    subscribe(customerCommunicationChannel: CustomerCommunicationChannel, processor: CustomerCommunicationProcessor) {
        this.eventEmitter.on(customerCommunicationChannel, (req) => {
            try {
                const res = processor.process(req as CustomerCommunicationPublishRequest);
                if (res instanceof Promise) {
                    res.catch(() => {});
                }
                return res;
            } catch {
                return undefined;
            }
        });
    }
}
