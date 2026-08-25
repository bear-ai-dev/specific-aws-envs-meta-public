import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { EmailCustomerCommunicationProcessor } from './customerCommunication.entity.js';
import { CustomerCommunicationChannel, CustomerCommunicationEmail } from './customerCommunication.interface.js';

const email: CustomerCommunicationEmail = {
    subject: 'New invoice from Harbor Analytics #INV-4180',
    fromName: 'Harbor Analytics',
    fromEmail: 'no-reply@meteringco.example',
    toEmail: 'ap@harbor-analytics.example',
    content: '<html>Hi</html>',
    replyToName: 'Harbor Analytics',
    replyToEmail: 'support@meteringco.example',
    html: true,
};

const eventFor = (data: CustomerCommunicationEmail[]) => ({
    topic: CustomerCommunicationChannel.EMAIL,
    message: 'Sending email to customer',
    data,
});

describe('EmailCustomerCommunicationProcessor', () => {
    let send: jest.SpyInstance;

    beforeEach(() => {
        send = jest
            .spyOn(SESClient.prototype, 'send')
            .mockImplementation(() => Promise.resolve({ MessageId: 'test-message-id' }) as never);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('sends one message addressed only to the customer the event names', async () => {
        await new EmailCustomerCommunicationProcessor().process(eventFor([email]));

        expect(send).toHaveBeenCalledTimes(1);
        const command = send.mock.calls[0][0] as SendEmailCommand;
        expect(command.input).toEqual({
            Source: '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?= <no-reply@meteringco.example>',
            Destination: { ToAddresses: ['ap@harbor-analytics.example'] },
            ReplyToAddresses: ['Harbor Analytics <support@meteringco.example>'],
            Message: {
                Subject: { Charset: 'UTF-8', Data: 'New invoice from Harbor Analytics #INV-4180' },
                Body: { Html: { Charset: 'UTF-8', Data: '<html>Hi</html>' } },
            },
            ConfigurationSetName: 'defaultConfigurationSet',
        });
    });

    it('frames a non html communication as a text part', async () => {
        await new EmailCustomerCommunicationProcessor().process(eventFor([{ ...email, html: false }]));

        const command = send.mock.calls[0][0] as SendEmailCommand;
        expect(command.input.Message?.Body).toEqual({ Text: { Charset: 'UTF-8', Data: '<html>Hi</html>' } });
    });

    it('puts nothing on the wire for an event that carries no email', async () => {
        await new EmailCustomerCommunicationProcessor().process(eventFor([]));

        expect(send).not.toHaveBeenCalled();
    });

    it('does not substitute a recipient when the provider refuses one, and keeps delivering', async () => {
        send.mockRejectedValueOnce(new Error('MessageRejected'));
        const processor = new EmailCustomerCommunicationProcessor();

        await expect(
            processor.process(eventFor([{ ...email, toEmail: 'bounced@lattice-robotics.example' }])),
        ).resolves.toBeUndefined();
        await processor.process(eventFor([email]));

        expect(send).toHaveBeenCalledTimes(2);
        const [refused, delivered] = send.mock.calls.map(([command]) => command as SendEmailCommand);
        expect(refused.input.Destination?.ToAddresses).toEqual(['bounced@lattice-robotics.example']);
        expect(delivered.input.Destination?.ToAddresses).toEqual(['ap@harbor-analytics.example']);
    });
});
