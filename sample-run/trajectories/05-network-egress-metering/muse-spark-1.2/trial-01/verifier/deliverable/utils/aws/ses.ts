import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

export const sendEmail = async (
    subject: string,
    fromName: string,
    fromEmail: string,
    toEmail: string,
    content: string,
    replyToName: string,
    replyToEmail: string,
    html?: boolean,
): Promise<any> => {
    const sesClient = new SESClient({ region: 'us-west-2' });
    const base64ToName = Buffer.from(fromName).toString('base64');
    const finalFromName = `=?UTF-8?B?${base64ToName}?= <${fromEmail}>`;
    const param = {
        ConfigurationSetName: 'defaultConfigurationSet',
        Message: {
            Body: {
                ...(html
                    ? { Html: { Charset: 'UTF-8', Data: content } }
                    : { Text: { Charset: 'UTF-8', Data: content } }),
            },
            Subject: {
                Charset: 'UTF-8',
                Data: subject,
            },
        },
        Destination: {
            BccAddresses: [],
            CcAddresses: [],
            ToAddresses: [toEmail],
        },
        Source: `${finalFromName}`,
        ReplyToAddresses: [`${replyToName} <${replyToEmail}>`],
    };
    const command = new SendEmailCommand(param);
    const response = await sesClient.send(command);
    return response;
};
