import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { CustomerService } from "./customer.service.js";
import {
  CustomerCommunicationChannel,
  CustomerCommunicationPublishRequest,
  CustomerCommunicationEmail,
} from "./entities/customerCommunication.interface.js";

@Injectable()
export class CustomerEmailProcessor implements OnModuleInit {
  private readonly logger = new Logger(CustomerEmailProcessor.name);
  private sesClient: SESClient;
  private chain: Promise<void> = Promise.resolve();

  constructor() {
    const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
    const endpoint = process.env.AWS_ENDPOINT_URL;
    const config: any = {
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || "[REDACTED_AWS_ACCESS_KEY_ID]",
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "[REDACTED_AWS_SECRET_ACCESS_KEY]",
      },
    };
    if (endpoint) {
      config.endpoint = endpoint;
    }
    this.sesClient = new SESClient(config);
  }

  onModuleInit() {
    CustomerService.customerCommunicationSystem.subscribe(CustomerCommunicationChannel.EMAIL, {
      process: (req: CustomerCommunicationPublishRequest) => {
        // Preserve order of publishes; chain ensures one event's send completes before next event's send begins
        this.chain = this.chain.then(() => this.process(req)).catch((e) => this.logger.warn(`Chain error: ${e?.message || e}`));
      },
    });
  }

  async process(request: CustomerCommunicationPublishRequest) {
    if (!request?.data || request.data.length === 0) {
      return;
    }
    // One event => one SES message addressed only to its named customer (first element). Do not send multiple recipients per event.
    const email = request.data[0];
    try {
      await this.sendOne(email);
    } catch (e: any) {
      const name = e?.name || e?.Code || e?.__type || "";
      const message = e?.message || e?.Message || String(e);
      this.logger.warn(`SES SendEmail rejected for ${email?.toEmail}: ${name} ${message}`);
      // Do not invent fallback recipient (do not try data[1]) and do not stop later communications
    }
  }

  private async sendOne(email: CustomerCommunicationEmail) {
    if (!email?.toEmail) {
      this.logger.warn("Skipping email without toEmail");
      return;
    }
    const fromNameB64 = Buffer.from(email.fromName || "", "utf-8").toString("base64");
    const source = `=?UTF-8?B?${fromNameB64}?= <${email.fromEmail}>`;
    const replyTo = email.replyToName ? `${email.replyToName} <${email.replyToEmail}>` : email.replyToEmail;
    const isHtml = email.html === true;
    const destination = { ToAddresses: [email.toEmail] };
    const subject = { Data: email.subject, Charset: "UTF-8" };
    const body = isHtml
      ? { Html: { Data: email.content, Charset: "UTF-8" } }
      : { Text: { Data: email.content, Charset: "UTF-8" } };

    const command = new SendEmailCommand({
      Source: source,
      Destination: destination,
      Message: { Subject: subject, Body: body },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
      ConfigurationSetName: "defaultConfigurationSet",
    });
    await this.sesClient.send(command);
  }
}
