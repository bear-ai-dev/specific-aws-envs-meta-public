import { Logger } from '@nestjs/common';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import {
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
} from './customerCommunication.interface.js';

export class EmailCustomerCommunicationProcessor implements CustomerCommunicationProcessor {
    private readonly logger = new Logger(EmailCustomerCommunicationProcessor.name);
    private readonly sesClient: SESClient;
    private queue: Promise<void> = Promise.resolve();

    constructor() {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
        const endpoint = process.env.AWS_ENDPOINT_URL;
        this.sesClient = new SESClient({
            region,
            ...(endpoint ? { endpoint } : {}),
        });
    }

    // EventEmitter will not await, so we chain internally to keep wire order deterministic
    process = (request: CustomerCommunicationPublishRequest): void => {
        // chain to preserve order and isolate failures
        this.queue = this.queue
            .then(() => this.handle(request))
            .catch((e) => this.logger.error(`Queued email handling error: ${e?.message ?? e}`));
        // void return - emitter ignores it; queue ensures sequential SendEmail
    };

    private handle = async (request: CustomerCommunicationPublishRequest): Promise<void> => {
        if (!request?.data || request.data.length === 0) {
            return;
        }
        // One event must become one message addressed only to its named customer.
        // Do not batch multiple ToAddresses, do not fallback to second recipient.
        const email = request.data[0];
        if (!email) return;
        if (!email.toEmail || !email.subject || email.content === undefined || email.content === null) {
            return;
        }
        try {
            const fromName = email.fromName ?? '';
            const fromEmail = email.fromEmail ?? '';
            const replyToName = email.replyToName ?? '';
            const replyToEmail = email.replyToEmail ?? '';

            const encodedFromName = Buffer.from(fromName, 'utf-8').toString('base64');
            const source = `=?UTF-8?B?${encodedFromName}?= <${fromEmail}>`;
            const replyTo = `${replyToName} <${replyToEmail}>`;

            const subject = {
                Data: email.subject,
                Charset: 'UTF-8',
            };

            const body: any = {};
            if (email.html) {
                body.Html = {
                    Data: email.content,
                    Charset: 'UTF-8',
                };
            } else {
                body.Text = {
                    Data: email.content,
                    Charset: 'UTF-8',
                };
            }

            const command = new SendEmailCommand({
                Source: source,
                Destination: {
                    ToAddresses: [email.toEmail],
                },
                Message: {
                    Subject: subject,
                    Body: body,
                },
                ReplyToAddresses: [replyTo],
                ConfigurationSetName: 'defaultConfigurationSet',
            });

            await this.sesClient.send(command);
        } catch (err: any) {
            this.logger.error(`Failed to send email to ${email?.toEmail}: ${err?.message ?? err}`);
        }
    };
}
