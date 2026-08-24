import { buildSendEmailCommand, encodeDisplayName, formatSource } from './ses.js';

describe('ses wire framing', () => {
    it('encodes the sender display name as an RFC 2047 base64 encoded-word', () => {
        expect(encodeDisplayName('Harbor Analytics')).toEqual('=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?=');
        expect(encodeDisplayName('')).toEqual('=?UTF-8?B??=');
        expect(formatSource('Harbor Analytics', 'no-reply@meteringco.example')).toEqual(
            '=?UTF-8?B?SGFyYm9yIEFuYWx5dGljcw==?= <no-reply@meteringco.example>',
        );
    });

    it('frames an html email for a single recipient', () => {
        const { input } = buildSendEmailCommand({
            subject: 'New invoice from Harbor Analytics #INV-4180',
            fromName: 'Harbor Analytics',
            fromEmail: 'no-reply@meteringco.example',
            toEmail: 'ap@harbor-analytics.example',
            content: '<html>Hi</html>',
            replyToName: 'Harbor Analytics',
            replyToEmail: 'support@meteringco.example',
            html: true,
        });
        expect(input).toEqual({
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

    it('frames a non html email as a text body', () => {
        const { input } = buildSendEmailCommand({
            subject: 'Receipt',
            fromName: '',
            fromEmail: 'no-reply@meteringco.example',
            toEmail: 'payments@harbor-analytics.example',
            content: 'Thanks for your payment.',
            replyToName: 'Harbor Analytics',
            replyToEmail: 'support@meteringco.example',
        });
        expect(input.Source).toEqual('=?UTF-8?B??= <no-reply@meteringco.example>');
        expect(input.Message.Body).toEqual({ Text: { Data: 'Thanks for your payment.', Charset: 'UTF-8' } });
    });
});
