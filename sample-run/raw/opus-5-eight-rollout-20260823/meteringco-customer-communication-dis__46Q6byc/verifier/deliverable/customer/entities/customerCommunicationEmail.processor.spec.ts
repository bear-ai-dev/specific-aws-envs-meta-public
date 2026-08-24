import { SendEmailCommand } from '@aws-sdk/client-ses';
import { CustomerCommunicationEntity } from './customerCommunication.entity.js';
import { CustomerCommunicationChannel, CustomerCommunicationEmail } from './customerCommunication.interface.js';
import { CustomerCommunicationEmailProcessor } from './customerCommunicationEmail.processor.js';

const email = (overrides: Partial<CustomerCommunicationEmail> = {}): CustomerCommunicationEmail => ({
    subject: 'New invoice from Harbor Analytics #INV-4180',
    fromName: 'Harbor Analytics',
    fromEmail: 'no-reply@meteringco.example',
    toEmail: 'ap@harbor-analytics.example',
    content: '<html>Hi</html>',
    replyToName: 'Harbor Analytics',
    replyToEmail: 'support@meteringco.example',
    html: true,
    ...overrides,
});

describe('CustomerCommunicationEmailProcessor', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('frames a message the way the provider expects it', () => {
        const input = CustomerCommunicationEmailProcessor.buildSendEmailInput(email());
        expect(input).toEqual({
            Destination: { ToAddresses: ['ap@harbor-analytics.example'] },
            Message: {
                Subject: { Charset: 'UTF-8', Data: 'New invoice from Harbor Analytics #INV-4180' },
                Body: { Html: { Charset: 'UTF-8', Data: '<html>Hi</html>' } },
            },
            Source: '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?= <no-reply@meteringco.example>',
            ReplyToAddresses: ['Harbor Analytics <support@meteringco.example>'],
            ConfigurationSetName: 'defaultConfigurationSet',
        });
    });

    it('sends non html content as a text part', () => {
        const input = CustomerCommunicationEmailProcessor.buildSendEmailInput(
            email({ html: false, content: 'Merci pour votre paiement.' }),
        );
        expect(input.Message.Body).toEqual({ Text: { Charset: 'UTF-8', Data: 'Merci pour votre paiement.' } });
    });

    it('encodes an empty sender name as an empty encoded word', () => {
        const input = CustomerCommunicationEmailProcessor.buildSendEmailInput(email({ fromName: '' }));
        expect(input.Source).toEqual('=?UTF-8?B??= <no-reply@meteringco.example>');
    });

    it('delivers one message addressed only to the named customer of the event', async () => {
        const send = jest
            .spyOn(CustomerCommunicationEmailProcessor.getClient(), 'send')
            .mockImplementation((() => Promise.resolve({ MessageId: 'message-id' })) as never);
        const bus = new CustomerCommunicationEntity();
        bus.subscribe(CustomerCommunicationChannel.EMAIL, new CustomerCommunicationEmailProcessor());
        await bus.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email(), email({ toEmail: 'backup-ap@harbor-analytics.example' })],
        });
        await new Promise(setImmediate);
        expect(send).toHaveBeenCalledTimes(1);
        const command = send.mock.calls[0][0] as SendEmailCommand;
        expect(command.input.Destination.ToAddresses).toEqual(['ap@harbor-analytics.example']);
    });

    it('does not send anything for an event carrying no message', async () => {
        const send = jest
            .spyOn(CustomerCommunicationEmailProcessor.getClient(), 'send')
            .mockImplementation((() => Promise.resolve({ MessageId: 'message-id' })) as never);
        const bus = new CustomerCommunicationEntity();
        bus.subscribe(CustomerCommunicationChannel.EMAIL, new CustomerCommunicationEmailProcessor());
        await bus.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [],
        });
        await new Promise(setImmediate);
        expect(send).not.toHaveBeenCalled();
    });

    it('keeps delivering later communications after a refused recipient', async () => {
        const send = jest
            .spyOn(CustomerCommunicationEmailProcessor.getClient(), 'send')
            .mockImplementationOnce((() => Promise.reject(new Error('MessageRejected'))) as never)
            .mockImplementation((() => Promise.resolve({ MessageId: 'message-id' })) as never);
        const bus = new CustomerCommunicationEntity();
        bus.subscribe(CustomerCommunicationChannel.EMAIL, new CustomerCommunicationEmailProcessor());
        bus.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [
                email({ toEmail: 'bounced@lattice-robotics.example' }),
                email({ toEmail: 'fallback@lattice.example' }),
            ],
        });
        bus.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email({ toEmail: 'keiri@harbor-analytics.example' })],
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(send).toHaveBeenCalledTimes(2);
        const recipients = send.mock.calls.map((call) => (call[0] as SendEmailCommand).input.Destination.ToAddresses);
        expect(recipients).toEqual([['bounced@lattice-robotics.example'], ['keiri@harbor-analytics.example']]);
    });
});
