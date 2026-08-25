import { CustomerCommunicationEntity, EmailCustomerCommunicationProcessor } from './customerCommunication.entity.js';
import {
    CustomerCommunicationChannel,
    CustomerCommunicationEmail,
    CustomerCommunicationPublishRequest,
} from './customerCommunication.interface.js';

const email = (overrides: Partial<CustomerCommunicationEmail> = {}): CustomerCommunicationEmail => ({
    subject: 'New invoice from Harbor Analytics #INV-4180',
    fromName: 'Harbor Analytics',
    fromEmail: 'no-reply@meteringco.example',
    toEmail: 'ap@harbor-analytics.example',
    content: '<html>Hi,<br/>Your statement is ready.</html>',
    replyToName: 'Harbor Analytics',
    replyToEmail: 'support@meteringco.example',
    html: true,
    ...overrides,
});

const request = (...data: CustomerCommunicationEmail[]): CustomerCommunicationPublishRequest => ({
    topic: CustomerCommunicationChannel.EMAIL,
    message: 'Sending email to customer',
    data,
});

describe('EmailCustomerCommunicationProcessor', () => {
    let send: jest.Mock;

    beforeEach(() => {
        send = jest.fn().mockResolvedValue({ MessageId: '0100abc-mockaws' });
        jest.spyOn(EmailCustomerCommunicationProcessor, 'client').mockReturnValue({ send } as never);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const inputsSent = () => send.mock.calls.map(([command]) => command.input);

    it('frames html mail the way the provider recorded it', () => {
        expect(EmailCustomerCommunicationProcessor.buildSendEmailInput(email())).toEqual({
            Source: '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?= <no-reply@meteringco.example>',
            Destination: { ToAddresses: ['ap@harbor-analytics.example'] },
            ReplyToAddresses: ['Harbor Analytics <support@meteringco.example>'],
            Message: {
                Subject: { Data: 'New invoice from Harbor Analytics #INV-4180', Charset: 'UTF-8' },
                Body: { Html: { Data: '<html>Hi,<br/>Your statement is ready.</html>', Charset: 'UTF-8' } },
            },
            ConfigurationSetName: 'defaultConfigurationSet',
        });
    });

    it('sends a plain text body when the communication is not html', () => {
        const { Message } = EmailCustomerCommunicationProcessor.buildSendEmailInput(
            email({ html: undefined, content: 'Merci pour votre paiement.' }),
        );
        expect(Message.Body).toEqual({ Text: { Data: 'Merci pour votre paiement.', Charset: 'UTF-8' } });
    });

    it('encodes the sender display name, whatever it holds', () => {
        expect(EmailCustomerCommunicationProcessor.encodeDisplayName('Lattice Robotique Société')).toEqual(
            '=?UTF-8?B?TGF0dGljZSBSb2JvdGlxdWUgU29jacOpdMOp?=',
        );
        expect(EmailCustomerCommunicationProcessor.encodeDisplayName('')).toEqual('=?UTF-8?B??=');
    });

    it('turns one published communication into one message for the named customer', async () => {
        const system = new CustomerCommunicationEntity();
        system.publish(request(email()));
        await EmailCustomerCommunicationProcessor.flush();

        expect(send).toHaveBeenCalledTimes(1);
        expect(inputsSent()[0].Destination).toEqual({ ToAddresses: ['ap@harbor-analytics.example'] });
    });

    it('puts nothing on the wire when the communication carries no recipient', async () => {
        const system = new CustomerCommunicationEntity();
        system.publish(request());
        await EmailCustomerCommunicationProcessor.flush();

        expect(send).not.toHaveBeenCalled();
    });

    it('does not fall back to another recipient when the provider refuses one, and keeps going', async () => {
        send.mockRejectedValueOnce(new Error('MessageRejected'));
        const system = new CustomerCommunicationEntity();
        system.publish(
            request(
                email({ toEmail: 'bounced@lattice-robotics.example' }),
                email({ toEmail: 'backup-ap@lattice-robotics.example' }),
            ),
        );
        system.publish(request(email({ toEmail: 'keiri@harbor-analytics.example' })));
        await EmailCustomerCommunicationProcessor.flush();

        expect(send).toHaveBeenCalledTimes(2);
        expect(inputsSent().map(({ Destination }) => Destination.ToAddresses[0])).toEqual([
            'bounced@lattice-robotics.example',
            'keiri@harbor-analytics.example',
        ]);
    });

    it('subscribes the mail processor once, so no communication is sent twice', async () => {
        const system = new CustomerCommunicationEntity();
        system.subscribe(CustomerCommunicationChannel.EMAIL, CustomerCommunicationEntity.emailProcessor);
        system.publish(request(email()));
        await EmailCustomerCommunicationProcessor.flush();

        expect(send).toHaveBeenCalledTimes(1);
    });
});
