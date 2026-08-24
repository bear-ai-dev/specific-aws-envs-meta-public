import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Logger } from "@nestjs/common";
import {
    CustomerCommunicationProcessor,
    CustomerCommunicationPublishRequest,
} from "./entities/customerCommunication.interface.js";

export class CustomerCommunicationEmailProcessor implements CustomerCommunicationProcessor {
    private static readonly logger = new Logger(CustomerCommunicationEmailProcessor.name);
    private sesClient: SESClient;
    private queue: Promise<void> = Promise.resolve();

    constructor() {
        const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
        const endpoint = process.env.AWS_ENDPOINT_URL || "http://127.0.0.1:4566";
        // Credentials are already in env (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
        // The SDK will pick them up automatically, but we construct explicitly to be safe
        this.sesClient = new SESClient({
            region,
            endpoint,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID || "[REDACTED_AWS_ACCESS_KEY_ID]",
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "[REDACTED_AWS_SECRET_ACCESS_KEY]",
            },
        });
    }

    // Public entry preserves `this` and serializes deliveries so burst publishes keep wire order
    process = (request: CustomerCommunicationPublishRequest): void => {
        this.queue = this.queue.then(() => this.handle(request)).catch((e) => {
            CustomerCommunicationEmailProcessor.logger.warn(`Queue error: ${e}`);
        });
    };

    private handle = async (request: CustomerCommunicationPublishRequest): Promise<void> => {
        if (!request?.data || request.data.length === 0) {
            return;
        }
        // One event may contain multiple CustomerCommunicationEmail entries.
        // Per requirement, one email must become one SES message addressed only to its named customer.
        for (const email of request.data) {
            try {
                const fromNameB64 = Buffer.from(email.fromName ?? "", "utf-8").toString("base64");
                const source = `=?UTF-8?B?${fromNameB64}?= <${email.fromEmail}>`;
                const replyTo = `${email.replyToName} <${email.replyToEmail}>`;

                const subject = {
                    Data: email.subject,
                    Charset: "UTF-8",
                };

                // Wire convention from dispatch-capture: html flag decides which body part is set.
                // When html === true => Html body, otherwise Text body. Exactly one is set, the other omitted (null in outbox).
                const body = email.html
                    ? { Html: { Data: email.content, Charset: "UTF-8" } }
                    : { Text: { Data: email.content, Charset: "UTF-8" } };

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
                    ConfigurationSetName: "defaultConfigurationSet",
                });

                await this.sesClient.send(command);
            } catch (e: any) {
                // If the provider refuses that recipient (e.g., suppressed list -> MessageRejected),
                // do not invent a fallback recipient and do not let the refusal stop later communications.
                CustomerCommunicationEmailProcessor.logger.warn(
                    `Failed to send email to ${email.toEmail}: ${e?.message || e} Code=${e?.Code || e?.name}`,
                );
                // continue to next email
            }
        }
    };
}
