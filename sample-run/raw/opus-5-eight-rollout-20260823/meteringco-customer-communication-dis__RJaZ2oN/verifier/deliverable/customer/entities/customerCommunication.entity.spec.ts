import {
    CustomerCommunicationEntity,
    EmailCustomerCommunicationProcessor,
    buildSendEmailInput,
    encodeEmailDisplayName,
} from './customerCommunication.entity.js';
import { CustomerCommunicationChannel } from './customerCommunication.interface.js';
import { sendEmail } from '../../utils/aws/ses.js';

jest.mock('../../utils/aws/ses.js', () => ({
    sendEmail: jest.fn(() => Promise.resolve({ MessageId: 'test-message-id' })),
}));

const sendEmailMock = sendEmail as jest.MockedFunction<typeof sendEmail>;

const email = {
    subject: 'New invoice from Harbor Analytics #INV-4180',
    fromName: 'Harbor Analytics',
    fromEmail: 'no-reply@meteringco.example',
    toEmail: 'ap@harbor-analytics.example',
    content: '<html>Hi,<br/>Your statement is ready.</html>',
    replyToName: 'Harbor Analytics',
    replyToEmail: 'support@meteringco.example',
    html: true,
};

describe('CustomerCommunicationEntity', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('Should base64 encode the sender display name, even when it is empty', () => {
        expect(encodeEmailDisplayName('Harbor Analytics')).toEqual('=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?=');
        expect(encodeEmailDisplayName('')).toEqual('=?UTF-8?B??=');
        expect(encodeEmailDisplayName(undefined)).toEqual('=?UTF-8?B??=');
    });

    it('Should frame an html communication for the provider', () => {
        expect(buildSendEmailInput(email)).toEqual({
            Source: '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?= <no-reply@meteringco.example>',
            Destination: { ToAddresses: ['ap@harbor-analytics.example'] },
            Message: {
                Subject: { Charset: 'UTF-8', Data: 'New invoice from Harbor Analytics #INV-4180' },
                Body: { Html: { Charset: 'UTF-8', Data: '<html>Hi,<br/>Your statement is ready.</html>' } },
            },
            ReplyToAddresses: ['Harbor Analytics <support@meteringco.example>'],
            ConfigurationSetName: 'defaultConfigurationSet',
        });
    });

    it('Should frame a plain text communication when html is not set', () => {
        const input = buildSendEmailInput({ ...email, html: undefined, content: 'Merci pour votre paiement.' });
        expect(input.Message.Body).toEqual({ Text: { Charset: 'UTF-8', Data: 'Merci pour votre paiement.' } });
    });

    it('Should send one message addressed only to the named customer', async () => {
        const communicationSystem = new CustomerCommunicationEntity();
        communicationSystem.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email, { ...email, toEmail: 'someone-else@harbor-analytics.example' }],
        });
        await EmailCustomerCommunicationProcessor.drain();

        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        expect(sendEmailMock.mock.calls[0][0].Destination).toEqual({
            ToAddresses: ['ap@harbor-analytics.example'],
        });
    });

    it('Should not send anything for a communication that names no customer', async () => {
        const communicationSystem = new CustomerCommunicationEntity();
        communicationSystem.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [],
        });
        await EmailCustomerCommunicationProcessor.drain();

        expect(sendEmailMock).not.toHaveBeenCalled();
    });

    it('Should keep delivering later communications when the provider refuses a recipient', async () => {
        sendEmailMock.mockRejectedValueOnce(new Error('MessageRejected'));
        const communicationSystem = new CustomerCommunicationEntity();
        communicationSystem.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [{ ...email, toEmail: 'bounced@lattice-robotics.example' }, { ...email }],
        });
        communicationSystem.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [{ ...email, toEmail: 'next@harbor-analytics.example' }],
        });
        await EmailCustomerCommunicationProcessor.drain();

        expect(sendEmailMock).toHaveBeenCalledTimes(2);
        // The refused message is never re-addressed to another recipient.
        expect(sendEmailMock.mock.calls[0][0].Destination).toEqual({
            ToAddresses: ['bounced@lattice-robotics.example'],
        });
        expect(sendEmailMock.mock.calls[1][0].Destination).toEqual({
            ToAddresses: ['next@harbor-analytics.example'],
        });
    });

    it('Should not subscribe the same processor to a channel twice', async () => {
        const communicationSystem = new CustomerCommunicationEntity();
        communicationSystem.subscribe(CustomerCommunicationChannel.EMAIL, new EmailCustomerCommunicationProcessor());
        communicationSystem.publish({
            topic: CustomerCommunicationChannel.EMAIL,
            message: 'Sending email to customer',
            data: [email],
        });
        await EmailCustomerCommunicationProcessor.drain();

        expect(sendEmailMock).toHaveBeenCalledTimes(1);
    });
});
