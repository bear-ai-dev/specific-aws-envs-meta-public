import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import {
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
} from './customerCommunication.interface.js';

export class CustomerCommunicationEmailProcessor implements CustomerCommunicationProcessor {
    private readonly logger = new Logger(CustomerCommunicationEmailProcessor.name);
    private readonly sesClient: SESClient;

    constructor() {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
        const endpoint = process.env.AWS_ENDPOINT_URL;
        // Explicit endpoint ensures we hit the local emulator; region from env matches account.
        if (endpoint) {
            this.sesClient = new SESClient({ region, endpoint });
        } else {
            this.sesClient = new SESClient({ region });
        }
    }

    // Use arrow to preserve `this` when passed as EventEmitter listener without bind
    process = async (request: CustomerCommunicationPublishRequest): Promise<void> => {
        try {
            if (!request || !Array.isArray(request.data) || request.data.length === 0) {
                this.logger.debug('CustomerCommunication EMAIL: no data, skipping');
                return;
            }
            const email = request.data[0];
            if (!email || !email.toEmail) {
                this.logger.debug('CustomerCommunication EMAIL: missing toEmail, skipping');
                return;
            }

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

            await this.sesClient.send(command);
            this.logger.log(`Email sent to ${email.toEmail}`);
        } catch (e: any) {
            // Provider refusal (MessageRejected) for suppressed or unverified sender should not invent fallback nor stop later communications
            const code = e?.name || e?.Code || 'Unknown';
            const msg = e?.message || String(e);
            this.logger.error(`Failed to send email via SES [${code}]: ${msg}`);
            // swallow error to allow next events
        }
    };
}
