import { mockClient } from 'aws-sdk-client-mock';
import { SendEmailCommand, SESClient } from '@aws-sdk/client-ses';
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

describe('EmailCustomerCommunicationProcessor', () => {
    beforeEach(() => {
        sesMock.reset();
        sesMock.on(SendEmailCommand).resolves({ MessageId: 'test-message-id' } as never);
    });

    it('sends one message addressed only to the customer named by the published event', async () => {
        const communicationSystem = new CustomerCommunicationEntity();
        const processor = new EmailCustomerCommunicationProcessor();
        communicationSystem.subscribe(CustomerCommunicationChannel.EMAIL, processor);
        communicationSystem.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email(), email({ toEmail: 'someone-else@harbor-analytics.example' })],
        });
        await processor.process({ topic: CustomerCommunicationChannel.EMAIL, message: 'flush', data: [] });
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

    it('sends plain text when the communication is not html', async () => {
        await new EmailCustomerCommunicationProcessor().process({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email({ html: false, content: 'Thanks for your payment.' })],
        });
        const [call] = sesMock.commandCalls(SendEmailCommand);
        expect(call.args[0].input.Message.Body).toEqual({
            Text: { Data: 'Thanks for your payment.', Charset: 'UTF-8' },
        });
    });

    it('sends nothing when the event carries no communication', async () => {
        await new EmailCustomerCommunicationProcessor().process({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [],
        });
        expect(sesMock.commandCalls(SendEmailCommand)).toHaveLength(0);
    });

    it('keeps delivering later communications when the provider refuses one', async () => {
        sesMock.reset();
        sesMock
            .on(SendEmailCommand)
            .rejectsOnce(new Error('MessageRejected'))
            .resolves({ MessageId: 'test-message-id' } as never);
        const processor = new EmailCustomerCommunicationProcessor();
        await processor.process({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email({ toEmail: 'bounced@lattice-robotics.example' })],
        });
        await processor.process({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email({ toEmail: 'ar@harbor-analytics.example' })],
        });
        const calls = sesMock.commandCalls(SendEmailCommand);
        expect(calls).toHaveLength(2);
        expect(calls[1].args[0].input.Destination).toEqual({ ToAddresses: ['ar@harbor-analytics.example'] });
    });
});
