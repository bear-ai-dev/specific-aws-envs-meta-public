import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { CustomerCommunicationEntity, EmailCustomerCommunicationProcessor } from './customerCommunication.entity.js';
import { CustomerCommunicationChannel, CustomerCommunicationEmail } from './customerCommunication.interface.js';

const baseEmail: CustomerCommunicationEmail = {
    subject: 'New invoice from Harbor Analytics #INV-4180',
    fromName: 'Harbor Analytics',
    fromEmail: 'no-reply@meteringco.example',
    toEmail: 'ap@harbor-analytics.example',
    content: '<html>Hi,<br/>Your statement is ready.</html>',
    replyToName: 'Harbor Analytics',
    replyToEmail: 'support@meteringco.example',
    html: true,
};

describe('EmailCustomerCommunicationProcessor', () => {
    let send: jest.SpyInstance;

    beforeEach(() => {
        send = jest
            .spyOn(SESClient.prototype, 'send')
            .mockImplementation((() => Promise.resolve({ MessageId: 'message-id' })) as never);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const publish = async (data: Array<CustomerCommunicationEmail>) => {
        const customerCommunicationSystem = new CustomerCommunicationEntity();
        customerCommunicationSystem.subscribe(
            CustomerCommunicationChannel.EMAIL,
            new EmailCustomerCommunicationProcessor(),
        );
        customerCommunicationSystem.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data,
        });
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
    };

    const sentCommands = () => send.mock.calls.map(([command]) => command.input);

    it('should send one html email addressed to the customer named by the event', async () => {
        await publish([baseEmail]);

        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0][0]).toBeInstanceOf(SendEmailCommand);
        expect(sentCommands()[0]).toEqual({
            Source: '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?= <no-reply@meteringco.example>',
            Destination: { ToAddresses: ['ap@harbor-analytics.example'] },
            ReplyToAddresses: ['Harbor Analytics <support@meteringco.example>'],
            ConfigurationSetName: 'defaultConfigurationSet',
            Message: {
                Subject: { Charset: 'UTF-8', Data: 'New invoice from Harbor Analytics #INV-4180' },
                Body: { Html: { Charset: 'UTF-8', Data: '<html>Hi,<br/>Your statement is ready.</html>' } },
            },
        });
    });

    it('should send a text body when the communication is not html', async () => {
        await publish([{ ...baseEmail, html: false, content: 'Your January statement is ready to download.' }]);

        expect(sentCommands()[0].Message.Body).toEqual({
            Text: { Charset: 'UTF-8', Data: 'Your January statement is ready to download.' },
        });
    });

    it('should encode a from name of any character set and leave the reply to name as framed', async () => {
        await publish([
            { ...baseEmail, fromName: 'Harbor Analytics 株式会社', replyToName: 'Harbor Kundenbetreuung Groß' },
        ]);

        expect(sentCommands()[0].Source).toEqual(
            '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcyDmoKrlvI/kvJrnpL4=?= <no-reply@meteringco.example>',
        );
        expect(sentCommands()[0].ReplyToAddresses).toEqual(['Harbor Kundenbetreuung Groß <support@meteringco.example>']);
    });

    it('should keep the encoded word framing when the communication carries no from name', async () => {
        await publish([{ ...baseEmail, fromName: '' }]);

        expect(sentCommands()[0].Source).toEqual('=?UTF-8?B??= <no-reply@meteringco.example>');
    });

    it('should send nothing when the event names no customer', async () => {
        await publish([]);

        expect(send).not.toHaveBeenCalled();
    });

    it('should not substitute another recipient for the one the event named', async () => {
        await publish([baseEmail, { ...baseEmail, toEmail: 'backup-ap@harbor-analytics.example' }]);

        expect(send).toHaveBeenCalledTimes(1);
        expect(sentCommands()[0].Destination).toEqual({ ToAddresses: ['ap@harbor-analytics.example'] });
    });

    it('should swallow a refusal so that later communications are still delivered', async () => {
        send.mockImplementationOnce((() =>
            Promise.reject(Object.assign(new Error('rejected'), { name: 'MessageRejected' }))) as never);

        await publish([{ ...baseEmail, toEmail: 'bounced@lattice-robotics.example' }]);
        await publish([baseEmail]);

        expect(send).toHaveBeenCalledTimes(2);
        expect(sentCommands()[1].Destination).toEqual({ ToAddresses: ['ap@harbor-analytics.example'] });
    });
});
