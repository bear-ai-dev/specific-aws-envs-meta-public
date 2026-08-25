import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { mockClient } from 'aws-sdk-client-mock';
import { CustomerCommunicationEntity, EmailCustomerCommunicationProcessor } from './customerCommunication.entity.js';
import { CustomerCommunicationChannel, CustomerCommunicationEmail } from './customerCommunication.interface.js';

const sesMock = mockClient(SESClient);

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

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('EmailCustomerCommunicationProcessor', () => {
    beforeEach(() => {
        sesMock.reset();
        sesMock.on(SendEmailCommand).resolves({ MessageId: 'message-id' });
    });

    it('sends one message per published communication, addressed to the named customer', async () => {
        const bus = new CustomerCommunicationEntity();
        bus.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email()],
        });
        await flush();

        const calls = sesMock.commandCalls(SendEmailCommand);
        expect(calls).toHaveLength(1);
        expect(calls[0].args[0].input).toEqual({
            Source: '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?= <no-reply@meteringco.example>',
            Destination: { ToAddresses: ['ap@harbor-analytics.example'] },
            ReplyToAddresses: ['Harbor Analytics <support@meteringco.example>'],
            Message: {
                Subject: { Data: 'New invoice from Harbor Analytics #INV-4180', Charset: 'UTF-8' },
                Body: { Html: { Data: '<html>Hi</html>', Charset: 'UTF-8' } },
            },
            ConfigurationSetName: 'defaultConfigurationSet',
        });
    });

    it('frames a plain text communication as a text body', () => {
        const input = EmailCustomerCommunicationProcessor.buildSendEmailInput(
            email({ html: false, content: 'Thanks for your payment.' }),
        );
        expect(input.Message.Body).toEqual({ Text: { Data: 'Thanks for your payment.', Charset: 'UTF-8' } });
    });

    it('encodes a non ascii sender name and an empty sender name the same way', () => {
        expect(EmailCustomerCommunicationProcessor.encodeDisplayName('Harbor Analytics 株式会社')).toEqual(
            '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcyDmoKrlvI/kvJrnpL4=?=',
        );
        expect(EmailCustomerCommunicationProcessor.encodeDisplayName('')).toEqual('=?UTF-8?B??=');
    });

    it('sends nothing when the communication carries no recipient', async () => {
        const bus = new CustomerCommunicationEntity();
        bus.publish({ topic: CustomerCommunicationChannel.EMAIL, message: 'Sending email to customer', data: [] });
        await flush();
        expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });

    it('does not fall back to another recipient and keeps delivering later communications', async () => {
        sesMock.on(SendEmailCommand).rejectsOnce(new Error('MessageRejected')).resolves({ MessageId: 'message-id' });
        const bus = new CustomerCommunicationEntity();

        bus.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [
                email({ toEmail: 'bounced@lattice-robotics.example' }),
                email({ toEmail: 'backup-ap@lattice-robotics.example' }),
            ],
        });
        await flush();
        bus.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email({ toEmail: 'ar@harbor-analytics.example' })],
        });
        await flush();

        const recipients = sesMock
            .commandCalls(SendEmailCommand)
            .map((call) => call.args[0].input.Destination.ToAddresses);
        expect(recipients).toEqual([['bounced@lattice-robotics.example'], ['ar@harbor-analytics.example']]);
    });
});
